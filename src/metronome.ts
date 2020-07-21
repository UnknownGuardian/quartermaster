type DelayedCall = {
  tickToExecute: number;
  callback: Function;
};

import "colors";

class Metronome {
  // don't do work when there is nothing to do
  _sleepResolve: Function | null;
  // need an interval since node can exit early if no work is being done
  _keepAlive: any;

  _callbacks: DelayedCall[];
  _currentTick: number;
  constructor() {
    this._currentTick = 0;
    this._callbacks = [];
    this._sleepResolve = null;
  }

  now() {
    return this._currentTick;
  }

  async start(ticksToExecute: number = Infinity): Promise<void> {
    this._keepAlive = setInterval(() => console.log("timer keep-alive"), 5000);
    return new Promise(async (resolve) => {
      while (ticksToExecute--) {
        await this.tick();
      }
      resolve();
    });
  }

  async tick(): Promise<void> {
    await this.sleep();
    for (let i = 0; i < this._callbacks.length; i++) {
      const call = this._callbacks[i];
      if (call.tickToExecute == this._currentTick) {
        await call.callback();
        this._callbacks.splice(i, 1);
        i--;
      }
    }

    this._currentTick++;
  }

  // halt until resolved
  private async sleep() {
    if (this._callbacks.length == 0) {
      await new Promise((resolve) => {
        this._sleepResolve = resolve;
      });
    }
  }

  private async awake() {
    if (this._sleepResolve) {
      this._sleepResolve();
      this._sleepResolve = null;
    }
  }

  setTimeout(callback: Function, ticks: number) {
    ticks = Math.max(1, Math.floor(ticks));
    this._callbacks.push({
      callback,
      tickToExecute: this._currentTick + ticks,
    });
    this.awake();
  }

  setInterval(callback: Function, ticks: number) {
    this.setTimeout(() => {
      callback();
      // schedule next call
      this.setInterval(callback, ticks);
    }, ticks);
  }

  stop(clear: Boolean = true) {
    if (clear) this._callbacks.length = 0;
    if (this._keepAlive) clearInterval(this._keepAlive);
    this._keepAlive = null
  }

  wait(ticks: number): Promise<void> {
    return new Promise((resolve) => this.setTimeout(resolve, ticks));
  }

  resetCurrentTime(): void {
    this._currentTick = 0;
  }

  debug(): void {
    console.log("Metronome Debug".green.bold);
    console.log("Keep-Alive:", this._keepAlive ? "running".green : "stopped".yellow)
    console.log("Tasks Scheduled:", this._callbacks.length)
    console.log("Current Tick:", this.now())
  }

}

export const metronome = new Metronome();