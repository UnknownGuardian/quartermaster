import { Event, metronome, TimedDependency, stageSummary, sigmoid, simulation, eventSummary, stats, LRUCache } from "../src";
import "colors"

type QoSFunction = (latency: number, ageOfInformation: number) => number

// TODO: determine if there needs to be some age to this data
// So that it decays as new requests aren't made, thus prompting
// additional requests to flow through and refresh it?
class DependencyModel {
  public capacity: number = 20;
  private _latency: number[] = [];
  private _availability: number[] = [];

  private _lastTime: number = 0;
  private _maxTime: number = 1000 * 5;

  public addLatency(latency: number) {
    this._latency.push(latency);
    if (this._latency.length > this.capacity) {
      this._latency.shift();
    }
  }
  public addAvailability(available: number) {
    this._lastTime = metronome.now();
    this._availability.push(available);
    if (this._availability.length > this.capacity) {
      this._availability.shift();
    }
  }
  public getLatency(): number {
    if (this._latency.length < this.capacity) {
      return 0;
    }
    const sum = this._latency.reduce((a, c) => a + c, 0);
    const actualLatency = sum / this.capacity
    const weight = this.getWeight();
    const decayedLatency = actualLatency * weight + (1 - weight) * 0;
    return decayedLatency;
  }
  public getAvailability(): number {
    if (this._availability.length < this.capacity) {
      return 1;
    }
    const sum = this._availability.reduce((a, c) => a + c, 0);
    const actualAvailability = sum / this.capacity;
    const weight = this.getWeight();
    const decayedAvailability = actualAvailability * weight + (1 - weight) * 1;
    return decayedAvailability;
  }

  private getWeight(): number {
    return Math.max(0, 1 - (metronome.now() - this._lastTime) / this._maxTime);
  }


}


class SmartStage extends LRUCache {
  public quickFailValue: number = 0.01;
  public model: DependencyModel = new DependencyModel();

  public qos: QoSFunction = (latency, aoi) => sigmoid(latency, 190) * sigmoid(aoi, 500, 4);

  /**
   * Keep a model of the dependency when requests go through, recording
   * latency and availability, so we can predict future QoS.
   * 
   * Decide:
   * If cached, is it better to return dependency or cache?
   * If not,    is it better to return dependency or fail fast?
   * 
   */
  async workOn(event: Event): Promise<void> {
    const latency = this.model.getLatency();
    const availability = this.model.getAvailability();
    const expectedDependencyQoS = this.qos(latency, 0) * availability;

    // branches to exit early (cache, fail)
    const cached = this.get(event.key);
    if (cached) {
      // determine if we should exit early with the cached value
      // availability = 1 since we know we have cached
      const cachedQoS = this.qos(0, metronome.now() - cached.time) * 1;
      if (cachedQoS > expectedDependencyQoS) {
        stats.add("smart.cache.earlyexit", 1);
        stats.add("smart.cache.earlyexit.age", metronome.now() - cached.time)
        return;
      } else {
        stats.add("smart.cache.noearlyexit", 1);
      }
    } else {
      // determine if we should exit early with a failure
      // availability = some threshold set to know when it is better to fail fast
      const exitEarlyQoS = this.qos(0, 0) * this.quickFailValue;
      if (exitEarlyQoS > expectedDependencyQoS) {
        stats.add("smart.nocache.earlyexit", 1);
        stats.add("smart.nocache.earlyexitqos", exitEarlyQoS);
        stats.add("smart.nocache.earlyexitdependencyQos", expectedDependencyQoS);
        throw "fail"
      } else {
        stats.add("smart.nocache.noearlyexit", 1);
      }
    }

    if (down) {
      stats.add('down.dependencycall', 1);
    }

    // call the dependency
    const t = metronome.now();
    try {
      await this.wrapped.accept(event);
      this.model.addAvailability(1);
      this.set(event.key, { time: metronome.now() })
      stats.add("smart.live.latency", metronome.now() - t)
      if (down) {
        stats.add('down.dependencycall.succeed', 1)
      }
    } catch {
      this.model.addAvailability(0);
    }
    finally {
      this.model.addLatency(metronome.now() - t);
    }
  }
}


const live = new TimedDependency();
live.availability = 1;
live.mean = 100;
live.std = 20;

const smart = new SmartStage(live);
smart.capacity = 200; // only 200 items cached
smart.ttl = 1000 * 60 * 5; // 5 minutes
smart.qos = (latency, aoi) =>
  sigmoid(latency, 150) * //prefer faster than 150ms
  sigmoid(aoi, 1000 * 60 * 2, 4); // younger than 2 minutes

let down = false;
metronome.setTimeout(() => {
  down = true
  live.availability = 0.25;
  live.mean = 200;
  live.std = 30;
  console.log("Before", simulation.getEventsSent())
  console.log("Model", smart.model.getAvailability(), smart.model.getLatency())
}, 10 * 1000);

metronome.setTimeout(() => {
  down = false;
  live.availability = 1;
  live.mean = 100;
  live.std = 20;
  console.log("After", simulation.getEventsSent())
  console.log("Model", smart.model.getAvailability(), smart.model.getLatency())
}, 30 * 1000);

// scenario
simulation.keyspaceMean = 300;
simulation.keyspaceStd = 50;
simulation.eventsPer1000Ticks = 80


async function novel() {
  console.log("\nNovel Technique\n".green)
  const events = await simulation.run(smart, 100000);
  eventSummary(events);
  stageSummary([smart, live])
  stats.summary();
  metronome.debug()
}
novel();