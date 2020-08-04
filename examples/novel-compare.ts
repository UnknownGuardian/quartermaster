import { Cache, TimedDependency, stageSummary, simulation, eventSummary } from "../src";
import "colors"

const live = new TimedDependency();
live.availability = 0.7;
live.mean = 150;
live.std = 20;

const smart = new Cache(live);

novel();
async function novel() {
  const events = await simulation.run(smart, 200000);
  eventSummary(events);
  stageSummary([smart, live])
}