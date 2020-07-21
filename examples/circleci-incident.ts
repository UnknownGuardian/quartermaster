/**
 * 
 * Examine what parts of the system we want to represent.
 * 
 * Github Push hook = one event. They started with none, then had "several 
 * multiples of our normal peak" traffic.
 * 
 * GithubHookReciever = entry point
 * Some retry strategy
 * A failing database
 * 
 * Described flow from incident report:
 * 1. Github sends events to CircleCI via push hooks
 * 2. The events are queued in the build queue.
 * 3. On enqueue, write to DB (? unclear)
 * 4. On dequeue, database is queried for info on customer plans, container 
 *      allocation, etc. Also likely that the work to be done is writen to the DB.
 * 5. On success, start work.
 * 6. On Fail
 * 
 * 
 * Properties:
 * - The build queue is not bounded
 * - The build queue is complex priority queue
 * - Degradation occured within 2 minutes
 * - Dequeue started slowing down to 1 per minute (instead of many per second)
 * - Queries take lots of time to run
 * - Many Queries time out (not sure if this is a timeout on the query side or 
 *      API layer)
 * 
 * Unknowns:
 * - Usage queue (builds sit here when customer doesn't have enough capacity)
 * - Run Queue (builds sit here waiting for system capacity)
 * 
 * 
 * Their course of action:
 * - Want to salvage queue and still process builds. However, they know value
 *   of the queued items is decreasing so they figure they can purge queue.
 *   They can't just drop data (likely because they have complex software), so
 *   they need a way to unlock DB to rewrite parts.
 * - Stop new builds from joining the queue through load balancer.
 * - Swap in some new build scheduling infra (probably workers
 * - Step down DB, promote secondary (which was overhwlmed)
 * - Turn off automatic re-enqueueing on infrastructure failures (like 500s?)
 * -
 * 
 */

import { Stage, Event, metronome, normal, FIFOQueue, WrappedStage, simulation, eventSummary, stageSummary, Retry, TimeStats, stats } from "../src";

class GithubHookReceiver extends WrappedStage {
  constructor(protected wrapped: Stage) {
    super(wrapped);

    // build queue
    this.inQueue = new FIFOQueue(Infinity, 110);
  }
  async workOn(event: Event): Promise<void> {
    // some work happens here
    const latency = normal(8, 2);
    await metronome.wait(latency);

    // hit DB
    await this.wrapped.accept(event);

    // do some other work, which we don't care about in simulation
  }
}



/**
 * Database with 3 modes:
 * 1. Normal
 * 2. Latent (80-99 concurrent connections)
 * 3. Deadlocked (100 concurrent connections)
 */
type Item = { event: Event, resolve?: Function }
class DB extends Stage {
  public concurrent: number = 0;
  public currentlyAccessingKeys: Record<string, Item[]> = {};

  public deadlockMonitorTiming = 5000;
  public deadlockStats = 0;

  public latentThreshold = 80;

  public mean: number = 20;
  public errorMean: number = 5;
  public std: number = 50;
  public errorStd: number = 10;


  public availability = 0.9995;

  constructor() {
    super();
    this.inQueue = new FIFOQueue(1, 100);

    metronome.setInterval(() => {
      this.unlock()
    }, this.deadlockMonitorTiming)
  }

  async workOn(event: Event): Promise<void> {
    this.concurrent++;

    const item: any = { event }
    if (!this.currentlyAccessingKeys[event.key]) {
      this.currentlyAccessingKeys[event.key] = [];
    }

    this.currentlyAccessingKeys[event.key].push(item);

    try {
      // handle deadlocks
      const isLocked = this.currentlyAccessingKeys[event.key].length > 1
      if (isLocked) {
        const t = metronome.now();
        await new Promise((resolve) => item.resolve = resolve).finally(() => {
          stats.add("db.locked", metronome.now() - t);
        })
      }

      // handle extra latency form load
      const isLatent = this.concurrent >= this.latentThreshold;
      if (isLatent) {
        const extraLatency = 10 * this.concurrent;
        await metronome.wait(extraLatency);
      }

      // normal latency and availability from fulfilling queries
      const available = Math.random() < this.availability;
      if (available) {
        const latency = normal(this.mean, this.std);
        await metronome.wait(latency);
        return;
      }
      const latency = normal(this.mean, this.std);
      await metronome.wait(latency);
      return Promise.reject("fail");
    } finally {
      this.concurrent--;

      const index = this.currentlyAccessingKeys[event.key].findIndex(x => x == item);
      this.currentlyAccessingKeys[event.key].splice(index, 1);
    }
  }

  // unlock deadlocked resource. 
  // TODO: Reject instead?
  public unlock() {
    for (const key in this.currentlyAccessingKeys) {
      const items = this.currentlyAccessingKeys[key];
      if (items.length > 0) {
        if (items[0].resolve) {
          items[0].resolve();
          delete items[0].resolve;
        }
      }
    }
  }

}




const db = new DB();
const retry = new Retry(db);
retry.attempts = 10;
const rec = new GithubHookReceiver(retry);


simulation.keyspaceMean = 1000;
simulation.keyspaceStd = 200;
simulation.eventsPer1000Ticks = 250;



work();
async function work() {
  const events = await simulation.run(rec, 20000);
  eventSummary(events);
  stageSummary([db, rec])
  stats.summary();
  metronome.debug();
}


