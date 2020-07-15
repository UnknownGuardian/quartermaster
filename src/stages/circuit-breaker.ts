import { WrappedStage } from "./wrapped-stage";
import { Event, Response, metronome } from "../";
/**
 * Wraps a stage and prevents it from being called if its error rate
 * crosses a threshold. This ensures that time isn't being spent
 * waiting for a response that has a non-zero change of a failure.
 */

export class CircuitBreaker extends WrappedStage {
  public threshold = 0.3;
  public capacity: number = 10;
  public timeInOpenState: number = 3000;


  protected _state: "closed" | "open" | "half-open" = "closed";
  protected _ring: number[] = [];
  protected _openTime = 0;
  async workOn(event: Event): Promise<void> {
    if (this._state == "open")
      throw "fail";
    await this.workOn(event);
  }


  protected success(event: Event): Response {
    this.record(0);
    return super.success(event);
  }


  protected fail(event: Event): Response {
    this.record(1);
    return super.success(event);
  }


  protected record(status: number): void {
    this._ring.push(status);
    if (this._ring.length > this.capacity) {
      this._ring.shift();
    }

    this.decideState();
  }

  // We have 0, 0, 0, 0, 0, 0, 0, 1, 1, 1
  // avg = 0.3. avg > threshold ? 

  public decideState(): void {
    const sum = this._ring.reduce((a, c) => a + c, 0);
    if (this._ring.length >= this.capacity) {
      const sum = this._ring.reduce((a, c) => a + c, 0);
      const avg = sum / this.capacity;

      switch (this._state) {
        case "closed":
          if (avg > this.threshold)
            this.open();
          break;
        case "open":
          const diff: number = metronome.now() - this._openTime;
          if (diff > this.timeInOpenState)
            this.halfOpen();
          break;
        case "half-open":
          if (avg > this.threshold)
            this.open();
          else
            this.close();
      }
    }
  }


  public open(): void {
    this._state = "open";
    this._ring = [];
  }
  protected close(): void {
    this._state = "closed";
  }
  protected halfOpen(): void {
    this._state = "half-open";
  }
}
