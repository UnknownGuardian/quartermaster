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
  const cb = new StatCircuitBreaker(dependency);
  cb.timeInOpenState = 200;

  metronome.setInterval(() => {
    simulation.eventsPer1000Ticks = Math.sin(metronome.now() / 1000) * 200 + 340
  }, 10);

  metronome.setInterval(function () {
    const obj = {
      now: metronome.now(),
      eventRate: simulation.eventsPer1000Ticks,
      cb: cb.state
    }
    stats.record("poll", obj)
  }, 100);

  const events = await simulation.run(cb, 10000);

  const now = stats.getRecorded("poll").map(x => x.now);
  const eventRate = stats.getRecorded("poll").map(x => x.eventRate);

  const shapes = [];
  const opens = stats.getRecorded("open").map(x => {
    const line: Partial<Shape> = {
      type: "line",
      x0: x,
      y0: 0,
      x1: x,
      y1: 1,
      xref: "x",
      yref: "paper",
      line: {
        color: 'rgb(171, 50, 96)',
        width: 1
      }
    }
    return line;
  })
  const closes = stats.getRecorded("close").map(x => {
    const line: Partial<Shape> = {
      type: "line",
      x0: x,
      y0: 0,
      x1: x,
      y1: 1,
      xref: "x",
      yref: "paper",
      line: {
        color: 'rgb(50, 171, 96)',
        width: 1
      }
    }
    return line;
  })
  const halfOpens = stats.getRecorded("halfOpen").map(x => {
    const line: Partial<Shape> = {
      type: "line",
      x0: x,
      y0: 0,
      x1: x,
      y1: 1,
      xref: "x",
      yref: "paper",
      line: {
        color: 'rgb(50, 171, 171)',
        width: 1
      }
    }
    return line;
  })


  const trace: Plot = {
    x: now,
    y: eventRate,
    type: "scatter",
  }
  const trace2: Plot = {
    x: events.map(x => x.responseTime.endTime),
    y: events.map(x => x.response == "success" ? 1 : 0),
    type: "scatter",
    yaxis: "y2",
    mode: "markers"
  }
  const layout: Layout = {
    title: "Shock",
    xaxis: {
      title: "Window"
    },
    yaxis: {
      title: "Event Rate"
    },
    yaxis2: {
      title: "Success / Fail",
      side: "right",
      overlaying: "y",
      range: [0, 2]
    },
    showlegend: true,
    shapes: opens.concat(closes).concat(halfOpens)
  }
  plot([trace, trace2], layout);

  //stats.summary();
  console.log("--->", stats.getRecorded("poll"))
}



function draw() {

}