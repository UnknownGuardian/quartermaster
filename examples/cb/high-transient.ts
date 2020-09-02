import {
  metronome,
  simulation,
  stats,
  CircuitBreaker,
  TimedDependency,
  stageSummary
} from "../../src";

/**
 * How does having slow failure strategy affect dependencies with high levels
 * of transient errors?
 * How does having slow recovery strategy affect dependencies with high levels
 * of transient errors?
 */

class SlowRecoveryCircuitBreaker extends CircuitBreaker {
  public openCapacity = 10;
  public halfOpenCapacity = 120;
  public closedCapacity = 60;
  public open(): void {
    super.open();
    this.capacity = this.openCapacity;
    stats.add('open', 1)
  }
  protected close(): void {
    super.close();
    this.capacity = this.closedCapacity;
    stats.add('close', 1)
  }
  protected halfOpen(): void {
    this._state = "half-open";
    this.capacity = this.halfOpenCapacity
    stats.add('half-open', 1)
  }
}

const dependency = new TimedDependency()
const dependency2 = new TimedDependency()
const dependency3 = new TimedDependency()
dependency.availability = dependency2.availability = dependency3.availability = 0.85;
dependency.mean = dependency2.mean = dependency3.mean = 15;
dependency.std = dependency2.std = dependency3.std = 2;



// scenario
simulation.keyspaceMean = 1000;
simulation.keyspaceStd = 200;
simulation.eventsPer1000Ticks = 1000;

console.log("Press any key to continue");
process.stdin.once('data', async () => {
  await work();
  console.log("done")
});

async function work() {
  const cb = new CircuitBreaker(dependency);
  cb.errorThreshold = 0.3;
  cb.timeInOpenState = 1000;
  await simulation.run(cb, 10000);

  const cb2 = new SlowRecoveryCircuitBreaker(dependency2);
  cb2.errorThreshold = 0.3;
  cb2.timeInOpenState = 1000;
  await simulation.run(cb2, 10000);

}
