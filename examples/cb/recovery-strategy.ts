import {
  metronome,
  simulation,
  stats,
  CircuitBreaker,
  TimedDependency,
  stageSummary,
  eventSummary
} from "../../src";

/**
 * What is our recovery strategy?
 * 
 * How does it hold up in various degradations, like
 * a complete outage vs a high latency vs a low
 * availability vs some varying traffic?
 * 
 * Reduce time in open state when using 3 state?
 * 
 */


class StatCircuitBreaker extends CircuitBreaker {
  public open(): void {
    //stats.record("ring-before-open", this.ring)
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
dependency.availability = 0.9995;
dependency.mean = 15;
dependency.std = 2;
const cb = new StatCircuitBreaker(dependency);
cb.capacity = 20;
cb.errorThreshold = 0.25;
cb.timeInOpenState = 2000;

// scenario
simulation.keyspaceMean = 1000;
simulation.keyspaceStd = 200;
simulation.eventsPer1000Ticks = 1000;

async function work() {
  const events = await simulation.run(cb, 100000);
  stats.summary();
  eventSummary(events);
  stageSummary([cb, dependency]);
}
upDownUpScenario();
//lowAvailableScenario();
work();

function upDownUpScenario() {
  // up for 2 seconds, down for 10 seconds, up again.
  metronome.setTimeout(function () {
    dependency.availability = 0;
  }, 2000);
  metronome.setTimeout(function () {
    dependency.availability = 0.9995;
  }, 12000);
}

function lowAvailableScenario() {
  // up for 2 seconds, low availability for 10 seconds, up again.
  metronome.setTimeout(function () {
    dependency.availability = 0.80
  }, 2000);
  metronome.setTimeout(function () {
    dependency.availability = 0.9995;
  }, 12000);
}





metronome.setInterval(function () {
  const ring = cb.ring;
  if (ring.length < cb.capacity)
    return;
  const sum = ring.reduce((a, c) => a + c, 0);
  const avg = sum / cb.capacity;
  //stats.record("cb.model-availability", avg);
  //stats.add("model-availability", avg);
}, 100)