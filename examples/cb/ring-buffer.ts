import {
  metronome,
  simulation,
  stats,
  CircuitBreaker,
  TimedDependency,
  Event,
  Response,
  WrappedStage
} from "../../src";
import { plot, Plot, Layout } from "nodeplotlib"

/**
 * When storing successes and failures in a ring buffer of length N, what is the proper 
 * acceptable error threshold (to trip a circuit breaker into the open state)?
 * 
 * Turns out, the shorter your ring buffer, the more likely it will have a "false-positive"
 * and trip open despite the actual availability not being close to the error threshold.
 * 
 * Additional factors that we don't investigate include:
 * events per second: The faster events happen, the smaller real time slice the ring
 *         buffer represents.
 */
class StatCircuitBreaker extends CircuitBreaker {
  public open(): void {
    super.open();
    stats.add('open', 1)
  }
}

type CircuitBreakerState = "closed" | "open" | "half-open"
class StatTimeWindowCircuitBreaker extends WrappedStage {
  public errorThreshold = 0.3;
  public window: number = 10;
  public timeInOpenState: number = 3000;


  protected _state: CircuitBreakerState = "closed";
  protected _ring: number[] = [];
  protected _ringAge: number[] = [];
  protected _openTime = 0;
  async workOn(event: Event): Promise<void> {
    if (this._state == "open")
      throw "fail";
    await this.wrapped.accept(event);
  }


  protected success(event: Event): Response {
    this.record(0);
    return super.success(event);
  }


  protected fail(event: Event): Response {
    this.record(1);
    return super.fail(event);
  }


  protected record(status: number): void {
    this._ring.push(status);
    this._ringAge.push(metronome.now())

    if (this._ringAge[0] < metronome.now() - this.window) {
      this._ring.shift();
      this._ringAge.shift();
    }

    this.decideState();
  }

  // We have 0, 0, 0, 0, 0, 0, 0, 1, 1, 1
  // avg = 0.3. avg >= threshold ? 
  /**
   * A side effect is that after going into the OPEN state, if requests
   * stop for > TimeInOpenState, it doesn't matter since the ring has
   * to fill up first
   */
  public decideState(): void {
    if (this._ring.length >= 20) {
      const sum = this._ring.reduce((a, c) => a + c, 0);
      const avg = sum / this._ring.length;
      switch (this._state) {
        case "closed":
          if (avg > this.errorThreshold)
            this.open();
          break;
        case "open":
          const diff: number = metronome.now() - this._openTime;
          if (diff > this.timeInOpenState)
            this.halfOpen();
          break;
        case "half-open":
          if (avg > this.errorThreshold)
            this.open();
          else
            this.close();
          break;
      }
    }
  }


  public open(): void {
    if (this.state == "open")
      return;

    stats.add('open', 1)
    this._state = "open";
    this._ring = [];
    this._ringAge = [];
    this._openTime = metronome.now();
  }
  protected close(): void {
    if (this.state == "closed")
      return;

    this._state = "closed";
    this._ring = [];
    this._ringAge = [];
  }
  protected halfOpen(): void {
    if (this.state == "half-open")
      return;

    this._state = "half-open";
    this._ring = []
    this._ringAge = [];
  }

  get state(): CircuitBreakerState {
    return this._state;
  }
  get ring(): number[] {
    return this._ring;
  }
}

const dependency = new TimedDependency()
dependency.availability = 0.85;
dependency.mean = 15;
dependency.std = 2;

// scenario
simulation.keyspaceMean = 1000;
simulation.keyspaceStd = 200;
simulation.eventsPer1000Ticks = 1000;

console.log("Press any key to continue");
process.stdin.once('data', async () => {
  await workWindowBuffer();
  console.log("done")
  process.stdin.pause();
});

async function workRingBuffer() {
  const capacities = [];
  const thresholds = [];
  const opens = [];
  for (let capacity = 10; capacity < 120; capacity += 10) {
    for (let errorThreshold = 0; errorThreshold <= 1; errorThreshold += 0.025) {
      const cb = new StatCircuitBreaker(dependency);
      cb.timeInOpenState = 0;
      cb.capacity = capacity;
      cb.errorThreshold = errorThreshold;

      await sleep(500);
      await simulation.run(cb, 10000);
      const result = stats.get("open");
      console.log(`${capacity},${errorThreshold},${result}`)
      capacities.push(capacity);
      thresholds.push(errorThreshold);
      opens.push(result);
    }
  }
  console.log("drawing");
  const trace: Plot = {
    x: capacities,
    y: thresholds,
    z: opens,
    type: "scatter3d",
    mode: "markers"
  }
  const layout: Layout = {
    xaxis: {
      title: "Capacity"
    },
    yaxis: {
      title: "Error Threshold"
    },
  }
  plot([trace], layout);

  console.log("exited work")
}
async function workWindowBuffer() {
  const windows = [];
  const thresholds = [];
  const opens = [];
  for (let window = 5; window < 120; window += 5) {
    for (let errorThreshold = 0; errorThreshold <= 1; errorThreshold += 0.05) {
      const cb = new StatTimeWindowCircuitBreaker(dependency);
      cb.timeInOpenState = 0;
      cb.window = window;
      cb.errorThreshold = errorThreshold;

      await sleep(500);
      await simulation.run(cb, 10000);
      const result = stats.get("open");
      console.log(`${window},${errorThreshold},${result}`)
      windows.push(window);
      thresholds.push(errorThreshold);
      opens.push(result);
    }
  }
  console.log("drawing");
  const trace: Plot = {
    x: windows,
    y: thresholds,
    z: opens,
    type: "scatter3d",
    mode: "markers"
  }
  const layout: Layout = {
    xaxis: {
      title: "Window"
    },
    yaxis: {
      title: "Error Threshold"
    },
  }
  plot([trace], layout);

  console.log("exited work")
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}