import {
  simulation,
  CircuitBreaker,
  TimedDependency,
  stats,
  metronome,
  FIFOQueue,
} from "../../../src";

import { plot, Plot, Layout } from "nodeplotlib"
import { Shape } from "nodeplotlib/dist/lib/models/plotly.js";

/**
 * As traffic varies, how does a breaker trip?
 */



class StatCircuitBreaker extends CircuitBreaker {
  public open(): void {
    super.open();
    stats.record('open', metronome.now());
  }
  public close(): void {
    super.close();
    stats.record('close', metronome.now());
  }
  public halfOpen(): void {
    super.halfOpen();
    stats.record('halfOpen', metronome.now());
  }
}


const dependency = new TimedDependency()
dependency.inQueue = new FIFOQueue(1, 10);
dependency.availability = 1;
dependency.mean = 20;
dependency.std = 4;


// scenario
simulation.keyspaceMean = 1000;
simulation.keyspaceStd = 200;
simulation.eventsPer1000Ticks = 200;

console.log("Press any key to continue");
process.stdin.once('data', async () => {
  await work();
  console.log("done")
  process.stdin.pause();
});

async function work() {
  // shock

  // graph we want to plot is: 
  // How much failing work did we do?
  // vary time in open state,
  // vary the low availability #

  const availArr = [];
  const timeArr = [];
  const failingWork = [];
  for (let availabilityLow = 0; availabilityLow < 1; availabilityLow += 0.1) {
    for (let timeInOpenState = 200; timeInOpenState <= 1000; timeInOpenState += 100) {
      const cb = new StatCircuitBreaker(dependency);
      cb.timeInOpenState = timeInOpenState;

      await sleep(200);

      const before = dependency.availability;
      metronome.setTimeout(() => dependency.availability = availabilityLow, 1000);
      metronome.setTimeout(() => dependency.availability = before, 2000);
      console.log("Before simulation");
      const events = await simulation.run(cb, 10000);
      console.log("After simulation");
      const numBadWork = events.filter(x => x.response === "fail").length;
      metronome.debug(true);
      console.log(`${availabilityLow},${timeInOpenState},${numBadWork}`)
      console.log("\n\n")

      availArr.push(availabilityLow);
      timeArr.push(timeInOpenState);
      failingWork.push(numBadWork);

    }
  }

  const trace: Plot = {
    x: availArr,
    y: timeArr,
    z: failingWork,
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
}



function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}