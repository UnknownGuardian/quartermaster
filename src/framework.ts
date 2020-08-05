import { Stage, Event, Response, metronome, standardDeviation } from "."
import { normal } from "./util";


class Simulation {
  /**
   * The rate at which events are sent to the starting stage
   */
  eventsPer1000Ticks: number = 50;

  /**
   * The mean of keys used when creating new Events
   */
  keyspaceMean: number = 1000;

  /**
   * The standard deviation of keys used when creating new Events
   */
  keyspaceStd: number = 50;


  private _arrivalRate: number = 0;
  private _eventsSent: number = 0;


  /**
 * Execute a simulation
 * 
 * TODO: Move to own class, so we can set properties on this later, such as changing rates mid-simulation,
 * setting the keyspace, etc.
 * 
 * @param stage The stage where events will be inserted
 * @param numEventsToSend The number of events to be sent
 */
  async run(stage: Stage, numEventsToSend: number): Promise<Event[]> {
    const delta = 1 / this.eventsPer1000Ticks;
    metronome.start();

    const pendingEvents = await this.sendEvents(stage, numEventsToSend)
    const events = await Promise.all(pendingEvents);

    metronome.stop();
    //eventSummary(events);
    return events;
  }

  /**
   * A helper method to send events at the correct rate to the stage
   * @param stage 
   * @param numEventsToSend 
   */
  private async sendEvents(stage: Stage, numEventsToSend: number): Promise<Promise<Event>[]> {
    const events: Promise<Event>[] = [];
    let eventsSent = 0;

    while (true) {
      const tickDelta = 1000 / this.eventsPer1000Ticks;
      this._arrivalRate = this.eventsPer1000Ticks;
      this._eventsSent = eventsSent;

      if (tickDelta < 1) {
        // fire off multiple events per tick

        let eventsToSendThisTick = Math.floor(1 / tickDelta);
        if (eventsSent + eventsToSendThisTick > numEventsToSend) {
          eventsToSendThisTick = numEventsToSend - eventsSent;
        }
        events.push(...this.createEventBatch(stage, eventsToSendThisTick))
        eventsSent += eventsToSendThisTick;

        if (eventsSent >= numEventsToSend)
          break;

        // go to next tick
        await metronome.wait(1);
      } else {
        // fire off a single event per tick, might need to wait somemore.
        events.push(this.createEvent(stage));
        eventsSent++;

        if (eventsSent >= numEventsToSend)
          break;

        await metronome.wait(tickDelta);
      }
    }
    this._arrivalRate = 0;
    return events;
  }

  /**
   * A helper method to send a num events immediately to a stage
   * @param stage 
   * @param num 
   */
  private createEventBatch(stage: Stage, num: number): Promise<Event>[] {
    const events: Promise<Event>[] = [];
    for (let i = 0; i < num; i++) {
      events.push(this.createEvent(stage));
    }
    return events;
  }

  private createEvent(stage: Stage): Promise<Event> {
    const key = "e-" + normal(this.keyspaceMean, this.keyspaceStd);
    const event = new Event(key);
    const time = event.responseTime;
    time.startTime = metronome.now();

    return stage.accept(event).then(response => {
      event.response = response as Response;
      time.endTime = metronome.now();
      return event;
    }).catch(error => {
      event.response = error as Response;
      time.endTime = metronome.now();
      return event
    });
  }


  public getArrivalRate(): number {
    return this._arrivalRate;
  }
  public getEventsSent(): number {
    return this._eventsSent;
  }
  //TODO:
  /*async runForSomeTicks(stage: Stage, numTicks: number): Promise<void> {
  }*/
}

export const simulation = new Simulation();






/**
 * Show interesting stats from the event data.
 * 
 * Show the following stats:
 * 
 * 1. % QoS? (we don't have access to this data)
 * 2. % success
 * 3. % latencies
 * 4. % slow failures? (interesting?)
 * @param events The events that have completed the simulation
 */
export function eventSummary(events: Event[], additionalColumns?: EventSummaryColumnFunction[]): void {
  const summary = createEventSummary(events, additionalColumns);

  console.log("Overview of Events");
  console.table(summary);
}


type Summary = ResponseData[];
type ResponseData = {
  type: Response;
  count: number;
  percent: string;
  mean_latency: string;
  std_latency: string;
}
type EventSummaryColumnFunction = (events: Event[]) => number;
function createEventSummary(events: Event[], additionalColumns?: EventSummaryColumnFunction[]): Summary {
  const success: Event[] = [];
  const fail: Event[] = [];

  events.forEach(e => {
    if (e.response == "fail") {
      fail.push(e);
    } else {
      success.push(e);
    }
  })

  const count = (e: Event[]) => e.length;
  const percent = (e: Event[]) => events.length > 0 ? e.length / events.length : 0;
  const mean_latency = (e: Event[]) => e.map(e => e.responseTime.endTime - e.responseTime.startTime).reduce((sum, cur) => sum + cur, 0) / e.length;
  const std_latency = (e: Event[]) => standardDeviation(e.map(e => e.responseTime.endTime - e.responseTime.startTime));

  const others = additionalColumns || [];
  const names = ["count", "percent", "mean_latency", "std_latency"]
  const columns = [count, percent, mean_latency, std_latency, ...others];

  const successRow: any = { type: "success" as Response };
  const failRow: any = { type: "fail" as Response };

  const precision = 3;
  columns.forEach((col, i) => {
    const propName = names[i] || `Column ${i}`

    const successResult = col(success);
    successRow[propName] = successResult % 1 == 0 ? successResult : successResult.toFixed(precision);

    const failResult = col(fail);
    failRow[propName] = failResult % 1 == 0 ? failResult : failResult.toFixed(precision);
  })

  const table = [successRow, failRow];
  return table;
}

/**
 * Print a need summary to the console describing events' behavior within a
 * stage; specifically traffic and timing summaries.
 * 
 * @param stages A stage or an array of stages to report stats about
 */
export function stageSummary(stages: Stage | Stage[]): void {
  const arr = Array.isArray(stages) ? stages : [stages]
  const times = arr.map(s => s.time);
  const traffic = arr.map(s => ({ stage: s.time.stage, ...s.traffic }));
  console.log("\nOverview of event time spent in stage")
  console.table(times)
  console.log("\nOverview of event behavior in stage")
  console.table(traffic);
}

export function eventCompare(a: Event[], b: Event[]): void {
  const aSummary = createEventSummary(a);
  const bSummary = createEventSummary(b);

  const aSuccess = aSummary[0];
  const bSuccess = bSummary[0];

  const aFail = aSummary[1];
  const bFail = bSummary[1];


  const precision = 3;
  const diff: Summary = [
    {
      type: "success" as Response,
      count: bSuccess.count - aSuccess.count,
      percent: (parseFloat(bSuccess.percent) - parseFloat(aSuccess.percent)).toFixed(precision),
      mean_latency: (parseFloat(bSuccess.mean_latency) - parseFloat(aSuccess.mean_latency)).toFixed(precision),
      std_latency: (parseFloat(bSuccess.std_latency) - parseFloat(aSuccess.std_latency)).toFixed(precision),
    },
    {
      type: "fail" as Response,
      count: bFail.count - aFail.count,
      percent: (parseFloat(bFail.percent) - parseFloat(aFail.percent)).toFixed(precision),
      mean_latency: (parseFloat(bFail.mean_latency) - parseFloat(aFail.mean_latency)).toFixed(precision),
      std_latency: (parseFloat(bFail.std_latency) - parseFloat(aFail.std_latency)).toFixed(precision),
    }
  ]

  console.log("\nDiff of the events, (B - A):");
  console.table(diff);
}

