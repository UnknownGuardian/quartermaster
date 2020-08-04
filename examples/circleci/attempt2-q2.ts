import { WrappedStage, Event, metronome, normal, Stage, FIFOQueue, exponential, Retry, simulation, stats, eventSummary, stageSummary } from "../../src";
// started at 10am
class APILayer extends WrappedStage {
  constructor(protected wrapped: Stage) {
    super(wrapped);
    this.inQueue = new FIFOQueue(Infinity, 220);
  }

  async workOn(event: Event): Promise<void> {
    // do some work
    const latency = normal(8, 2);
    await metronome.wait(latency);
    await this.wrapped.accept(event);
  }
}


class Database extends Stage {
  private concurrent: number = 0;
  private availability = 0.9995;

  public latencyA = 0.06;
  public latencyB = 1.06;

  private deadlockThreshold = 70;
  private deadlockAvailability = 0.7;

  constructor() {
    super();
    this.inQueue = new FIFOQueue(1, 300);
  }

  async workOn(event: Event): Promise<void> {
    this.concurrent++;
    const mean = 30 + exponential(this.latencyA, this.latencyB, this.concurrent);
    const std = 5 + mean / 500;
    const latency = normal(mean, std);
    await metronome.wait(latency);

    this.concurrent--;


    if (this.concurrent + 1 >= this.deadlockThreshold) {
      if (Math.random() < this.deadlockAvailability) {
        throw "fail"
      }
    } else {
      if (Math.random() > this.availability) {
        throw "fail";
      }
    }
  }
}
const table: any = [];
const statInterval = 1000;

const db = new Database();
const retry = new Retry(db);
const api = new APILayer(retry);

retry.attempts = 10;
api.inQueue.setNumWorkers(50);

simulation.keyspaceMean = 1000;
simulation.keyspaceStd = 200;
simulation.eventsPer1000Ticks = 85000

async function work() {
  const events = await simulation.run(api, 85000);
  console.log('done')
  eventSummary(events);
  stageSummary([retry, db])
  console.table(table.slice(1, 80));
}

function recordStats() {
  const last = table[table.length - 1] || { queueSize: 0 }
  const queue = api.inQueue as FIFOQueue;
  const now = metronome.now();
  const queueSize = queue.length()
  const queueWorkers = queue.getNumWorkers();
  const eventRate = simulation.getArrivalRate()
  const queueProcessingRate = (last.queueSize - queueSize) / statInterval * 1000

  table.push({ now, queueSize, queueWorkers, eventRate, queueProcessingRate })

  api.inQueue.setNumWorkers(api.inQueue.getNumWorkers() + 2);
}
metronome.setInterval(recordStats, statInterval)

work();