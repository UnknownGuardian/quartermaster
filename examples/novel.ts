import { Event, Response, Cache, metronome, TimedDependency, stageSummary, sigmoid, simulation, eventSummary, stats } from "../src";
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
      if (currentQoS > expectedWaitQos) {
        stats.add("smart.cache.earlyexit", 1);
        throw "fail"
      } else {
        stats.add("smart.cache.noearlyexit", 1);
      }
    } else {
      // determine if we should wait for response
      const exitEarlyQoS = this.qos(0, 0) * this.earlyExitValue;
      if (exitEarlyQoS > expectedWaitQos) {
        stats.add("smart.nocache.earlyexit", 1);
        throw "fail"
      } else {
        stats.add("smart.nocache.noearlyexit", 1);
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
live.availability = 0.0000000001;
live.mean = 150;
live.std = 20;

const smart = new SmartStage(live);

novel();
async function novel() {
  const events = await simulation.run(smart, 200000);
  eventSummary(events);
  stageSummary([smart, live])
  stats.summary();
}
