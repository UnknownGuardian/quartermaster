import { Event, Response, Cache, metronome, TimedDependency, stageSummary, sigmoid, simulation, eventSummary } from "../src";
import "colors"

class SmartStage extends Cache {
  public earlyExitValue: number = 0.3;
  protected _latencyRing: number[] = [];
  protected _availabilityRing: number[] = [];
  public capacity: number = 10;
  async workOn(event: Event): Promise<void> {
    const latency = this.getLatency();
    const availability = this.getAvailability();
    const expectedWaitQos = this.qos(latency, 0) * availability;

    const cached = this.get(event.key);
    const inCache = !!cached;
    if (inCache) {
      // determine if we should exit early
      const currentQoS = this.qos(0, metronome.now() - cached.time);
      if (currentQoS > expectedWaitQos)
        return;
    } else {
      // determine if we should wait for response
      const exitEarlyQoS = this.qos(0, 0) * this.earlyExitValue;
      if (exitEarlyQoS > expectedWaitQos) {
        return;
      }
    }

    const t = metronome.now();
    await this.wrapped.accept(event);
    this.record(this._latencyRing, metronome.now() - t);
    this.set(event.key, { time: metronome.now() })
  }
  protected success(event: Event): Response {
    this.record(this._availabilityRing, 1);
    return super.success(event);
  }


  protected fail(event: Event): Response {
    this.record(this._availabilityRing, 0);
    return super.success(event);
  }

  protected record(ring: number[], status: number): void {
    ring.push(status);
    if (ring.length > this.capacity) {
      ring.shift();
    }
  }



  private getAvailability(): number {
    if (this._availabilityRing.length < this.capacity) {
      return 1;
    }
    const sum = this._availabilityRing.reduce((a, c) => a + c, 0);
    return sum / this.capacity
  }
  private getLatency(): number {
    if (this._latencyRing.length < this.capacity) {
      return 0;
    }
    const sum = this._latencyRing.reduce((a, c) => a + c, 0);
    return sum / this.capacity
  }
  private qos(latency: number, ageOfInformation: number): number {
    return this.costOfDelay(latency) * this.utility(ageOfInformation);
  }
  private costOfDelay(latency: number): number {
    return sigmoid(latency, 190);
  }
  private utility(ageOfInformation: number): number {
    return sigmoid(ageOfInformation, 500, 4);
  }

}


const live = new TimedDependency();
live.mean = 150;
live.std = 20;

const smart = new SmartStage(live);

novel();
async function novel() {
  const events = await simulation.run(smart, 20000);
  eventSummary(events);
  stageSummary([smart, live])
}








/*
Type            Count           QoS             AoI             Latency
Live            9748            1.00            0.00            95.45
Cached          192             1.00            3275.61         168.86
Fallbk          59              0.10            0.00            165.53
Total           9999            0.99            62.90           97.27


class SmartApproach extends Approach {
  private latencyRing: Ring = new Ring(5);

  public async callDependency(req: Request) {
    let availability = a.ring.total() / a.ring.capacity();
    if (availability < 0)
      availability = 1;
    let latency = this.latencyRing.total() / this.latencyRing.capacity();
    if (latency < 0)
      latency = 0;
    // Can we factor in availability with c.utility(availability)
    const expectedWaitQoS = c.costOfDelay(latency) * c.utility(availability);


    this.getCache(req);
    if (req.cache.length > 0) {
      // determine if we should exit early
      const currentQoS = c.costOfDelay(0) * c.utility(req.cache[0].ageOfInformation);
      if (currentQoS > expectedWaitQoS) {
        return;
      }

    } else {
      // determine if we should fallback or wait for response
      const fallbackQoS = c.costOfDelay(0) * c.utility(a.retryPolicy.fallback);
      if (fallbackQoS > expectedWaitQoS) {
        this.getFallback(req);
        return;
      }
    }

    await this.getDependency(req);
    this.getFallback(req);
  }

  protected async getDependency(req: Request) {
    await super.getDependency(req);
    this.latencyRing.enq(this.metronome.now() - req.startTime)
  }
}

const adaption: AdaptiveFunction = {
  func: () => { },
  toString: () => "none"
}
const a: Approach = new SmartApproach(10000, { discipline: "FIFO", length: 8, servers: 4 }, { count: 1, fallback: 0.1, timeout: 180 }, adaption);
const c: Context = {
  arrivalRate: new PoissonDistribution(30),
  capacity: 30,
  costOfDelay: (latency) => sigmoid(latency, 190),
  dependencyCapacity: 30,
  keyspace: new NormalDistribution(1000, 50),
  numRequests: 10000,
  utility: (aoi: number) => sigmoid(aoi, 500, 4),
}

let degraded: Condition = {
  availability: new ConstantDistribution(0.995),
  successLatency: new GammaDistribution(6, 15),
  errorLatency: new GammaDistribution(6, 15),
}

let sim = new Simulator(new Metronome(), a, c, [NormalCondition, degraded]);
run();

async function run() {
  await sim.run();
  summary(sim);
}



type Metric = {
  count: number;
  qos: number;
  latency: number;
  aoi: number;
}
function sigmoid(value: number, max: number, k: number = 3) {
  if (value >= max) return 0;
  value /= max;
  return 1 / (1 + Math.pow(1 / value - 1, -k));
}

(latency: number) => {
  const k = 3;
  const max = 190; // somewhere around 98%
  if (latency > max) return 0;

  latency /= max;

  return 1 / (1 + Math.pow(1 / latency - 1, -k));
}


function summary(sim: Simulator) {
  sim.printSummary();

}
*/