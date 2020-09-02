import {
  metronome,
  simulation,
  stats,
  CircuitBreaker,
  TimedDependency,
  stageSummary
} from "../../src";

/**
 * There might be a time when the percent of transient errors increases in your service.
 * Using a circuit breaker that fails fast could subject your service to a large degradation
 * in quality when failing just a bit slower could have done the job.
 * 
 * Obviously you just add retry strategy? (What if you can't because rate limiting?)
 * 
 * 
 * Notes:
 * It actually isn't just as simple to set an acceptable error threshold and say
 * if it dips below that, we should close. At 90\% available, we still tripped
 * open 2,000 times.
 */


class StatCircuitBreaker extends CircuitBreaker {
  public open(): void {
    stats.record("ring-before-open", this.ring)
    super.open();
    stats.add('open', 1)
  }
  protected close(): void {
    super.close();
    stats.add('close', 1)
  }
  protected halfOpen(): void {
    this._state = "half-open";
    stats.add('half-open', 1)
  }
}



const dependency = new TimedDependency()
dependency.availability = 0.90;
dependency.mean = 15;
dependency.std = 2;
const cb = new StatCircuitBreaker(dependency);
cb.capacity = 20;
cb.errorThreshold = 0.3;
cb.timeInOpenState = 0;

// scenario
simulation.keyspaceMean = 1000;
simulation.keyspaceStd = 200;
simulation.eventsPer1000Ticks = 1000;

async function work() {
  const events = await simulation.run(cb, 50000);
  console.log("done");
  stats.summary();
  stageSummary([cb, dependency]);
}
work();


metronome.setInterval(function () {
  const ring = cb.ring;
  if (ring.length < cb.capacity)
    return;
  const sum = ring.reduce((a, c) => a + c, 0);
  const avg = sum / cb.capacity;
  stats.record("cb.model-availability", avg);
  stats.add("model-availability", avg);
}, 100)