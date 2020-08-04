import { Stage, Event, metronome, normal, FIFOQueue, WrappedStage, simulation, eventSummary, stageSummary, Retry, TimeStats, stats, CircuitBreaker, AdaptiveCircuitBreaker, Timeout, exponential } from "../../src";

class GithubHookReceiver extends WrappedStage {
  constructor(protected wrapped: Stage) {
    super(wrapped);

    // build queue
    this.inQueue = new FIFOQueue(Infinity, 120);
  }
  async workOn(event: Event): Promise<void> {
    //stats.max('receiver.queuelength', (this.inQueue as FIFOQueue).length())

    // some work happens here
    const latency = normal(8, 2);
    await metronome.wait(latency);

    // hit DB
    await this.wrapped.accept(event);

    // do some other work, which we don't care about in simulation
  }
}

// alternatively, we could skip the Wrapped stage so there is no confusion
class GithubHookReceiver2 extends Stage {
  constructor(protected wrapped: Stage) {
    super();

    // build queue
    this.inQueue = new FIFOQueue(Infinity, 120);
  }
  async workOn(event: Event): Promise<void> {
    //stats.max('receiver.queuelength', (this.inQueue as FIFOQueue).length())

    // some work happens here
    const latency = normal(8, 2);
    await metronome.wait(latency);

    // hit DB
    await this.wrapped.accept(event);

    // do some other work, which we don't care about in simulation
  }
}


class CircleCIDatabase extends Stage {
  public concurrent: number = 0;
  public availability = 0.9995;
  public mean: number = 30;
  public std: number = 5;


  public latencyA = 0.06;
  public latencyB = 1.06;

  public deadlockThreshold = 70;
  public deadlockAvailability = 0.70;

  constructor() {
    super();
    this.inQueue = new FIFOQueue(1, 300);
  }

  async workOn(event: Event): Promise<void> {
    this.concurrent++;
    //stats.max("db.concurrent", this.concurrent)
    //if (this.concurrent >= this.deadlockThreshold)
    //  stats.add("db.deadlocked", 1);

    try {
      const concurrentLatency = exponential(this.latencyA, this.latencyB, this.concurrent);
      const concurrencyStd = concurrentLatency / 500;
      const latency = normal(this.mean + concurrentLatency, this.std + concurrencyStd);
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


class CircleCIDatabase2 extends Stage {
  public concurrent: number = 0;
  public availability = 0.9995;
  public mean: number = 30;
  public std: number = 5;


  public latencyA = 0.06;
  public latencyB = 1.06;

  public deadlockThreshold = 70;
  public deadlockAvailability = 0.70;

  constructor() {
    super();
    this.inQueue = new FIFOQueue(1, 300);
  }

  async workOn(event: Event): Promise<void> {
    this.concurrent++;

    const latencyMean = this.mean + exponential(this.latencyA, this.latencyB, this.concurrent);
    const concurrencyStd = this.std + latencyMean / 500;
    const latency = normal(latencyMean, concurrencyStd);
    await metronome.wait(latency);

    this.concurrent--;

    if (this.concurrent >= this.deadlockThreshold) {
      if (Math.random() > this.deadlockAvailability)
        throw "fail";
    } else {
      if (Math.random() > this.availability)
        throw "fail";
    }
  }
}




const db = new CircleCIDatabase();
// initial improvements
db.latencyA = 0.05;
db.latencyB = 0.035;

const retry = new Retry(db);
retry.attempts = 10;

const rec = new GithubHookReceiver(retry);


simulation.keyspaceMean = 1000;
simulation.keyspaceStd = 200;
simulation.eventsPer1000Ticks = 5000;


let lastLength = 0;
const table: any[] = [];

function recordStats() {
  const len = (rec.inQueue as FIFOQueue).length();
  const change = (len - lastLength) * (1000 / interval)
  const processingRate = simulation.getArrivalRate() - change


  table.push({ now: metronome.now(), queueLength: len, eventRate: simulation.getArrivalRate(), change, processingRate, workers: rec.inQueue.getNumWorkers() })
  lastLength = len
}

const interval = 2000;
metronome.setInterval(recordStats, interval)




async function work() {
  const events = await simulation.run(rec, 65000);
  stats.summary();
  console.table(table.slice(0, 50));
}
work();
