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
 * 
 * 
 * Questions to look at?
 * - After the incident?
 * - What changes should we make?
 * - Can these changes hold up to the same set of events?
 * - Create a burst of traffic. Simulate db behavior. Think about what arch changes
 * could allow us to not overwhelm the database. 
 * 
 * Now that we know some limit to the DB, throw in the simulation and see what we can do.
 * 
 * 
 */

import { Stage, Event, metronome, normal, FIFOQueue, WrappedStage, simulation, eventSummary, stageSummary, Retry, TimeStats, stats, CircuitBreaker, AdaptiveCircuitBreaker, Timeout } from "../../src";

class GithubHookReceiver extends WrappedStage {
  constructor(protected wrapped: Stage) {
    super(wrapped);

    // build queue
    this.inQueue = new FIFOQueue(Infinity, 120);
  }
  async workOn(event: Event): Promise<void> {
    stats.max('receiver.queuelength', (this.inQueue as FIFOQueue).length())
    // some work happens here
    const latency = normal(8, 2);
    await metronome.wait(latency);

    // hit DB
    await this.wrapped.accept(event);

    // do some other work, which we don't care about in simulation
  }
}




/**
 * Database with exponential serving time 
 */
class DB extends Stage {
  public concurrent: number = 0;
  public availability = 0.9995;
  public mean: number = 30;
  public std: number = 5;

  // exponential latency (cc = concurrent connections)
  // cc   additional latency
  // 60   2
  // 80   8
  // 100  20
  // 120  65
  // 150 200
  public latencyX0 = 0.06;
  public latencyR = 0.06;

  public deadlockThreshold = 70;
  public deadlockAvailability = 0.70;

  constructor() {
    super();
    this.inQueue = new FIFOQueue(1, 300);
  }

  async workOn(event: Event): Promise<void> {
    this.concurrent++;
    stats.max("db.concurrent", this.concurrent)
    if (this.concurrent >= this.deadlockThreshold)
      stats.add("db.deadlocked", 1);

    try {
      const extraMean = this.latencyX0 * ((1 + this.latencyR) ** this.concurrent);
      const extraStd = extraMean / 500;
      const latency = normal(this.mean + extraMean, this.std + extraStd);
      await metronome.wait(latency);

      const actualAvailability = this.concurrent >= this.deadlockThreshold ? this.deadlockAvailability : this.availability;
      const availabile = Math.random() < actualAvailability;
      if (!availabile)
        throw "fail";

    } finally {
      this.concurrent--;
    }
  }
}




const db = new DB();
// initial improvements
//db.latencyX0 = 0.05;
//db.latencyR = 0.035;
const timeout = new Timeout(db);
timeout.timeout = 100;
const breaker = new AdaptiveCircuitBreaker(timeout);
const retry = new Retry(breaker);
retry.attempts = 1;
const rec = new GithubHookReceiver(retry);
breaker.setQueueToAlterNumWorkers(rec.inQueue);


simulation.keyspaceMean = 1000;
simulation.keyspaceStd = 200;
simulation.eventsPer1000Ticks = 5000;


const interval = 20;
let lastLength = 0;
const table: any[] = [];
metronome.setInterval(() => {
  const len = (rec.inQueue as FIFOQueue).length();
  const change = (len - lastLength) * (1000 / interval)
  const processingRate = simulation.getArrivalRate() - change


  table.push({ now: metronome.now(), queueLength: len, eventRate: simulation.getArrivalRate(), change, processingRate, workers: rec.inQueue.getNumWorkers() })
  lastLength = len
}, interval)


work();
async function work() {
  const events = await simulation.run(rec, 10000);
  eventSummary(events);
  //stageSummary([db, rec])
  stats.summary();
  //metronome.debug();
  console.table(table.slice(70, 120));
}

