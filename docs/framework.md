# Quartermaster - Framework

A fault tolerant technique can be generalized as a stage, consisting of a queue for inbound events, a worker pool to process events from the queue, and a set of overloadable event driven methods.

This document describes a typescript implementation of the Quartermaster model. To see the model itself, [read up on the description](model.md). To view the framework in use, [check out our examples](framework.md).

## Table of Contents

**[1. Stage](#Stage)**

**[2. Queue](#Queue)**

**[3. Worker Pool](#Worker-Pool)**

**[4. Event](#Event)**

**[5. Methods](#Event-Methods)**

**[6. Simulation](#Simulation)**

**[7. Timing](#Timing)**

## Stage

A technique is a stage. Since it is critical to model the dependency, the Quartermaster framework lends itself to making the dependency a stage. The system then becomes a chain, or tree, of stages.

![Chain of Stages](./img/retry-timeout-dependency.png)
_Diagram 1: A system with a retry and timeout modeled as a chain of stages_

The chain of stages can be accomplished in a few ways. A `WrappedStage` is provided as a helper class to construct these chains of stages. The `workOn()` method delivers the event to the wrapped stage, optionally waiting for a response.

For example, the `Timeout` stage's implementation is:

```typescript
export class Timeout extends WrappedStage {
  async workOn(event: Event): Promise<void> {
    //const tookTooLong = ...
    await Promise.race([tookTooLong, this.wrapped.accept(event)]);
  }
}
```

Events arrive to a stage in `accept(event)`. By default, no other methods are available for other stages to call. This is not a requirement of the model however, and stages can be more tightly coupled by extending the core functionality.

Furthermore, the default behavior (and flow) of an event through a stage is controlled by `accept(event)`, which can also be overwritten if necessary.

## Queue

The queue is an interface with a small contract that covers the queue and worker pool:

| Method               | Description                                                   |
| -------------------- | ------------------------------------------------------------- |
| `enqueue(event)`     | Returns a promise for a worker assigned to service the event. |
| `isFull()`           | Is the queue full?                                            |
| `setCapacity(num)`   | Sets the max length of the queue.                             |
| `getCapacity()`      | Gets the max length of the queue.                             |
| `hasFreeWorker()`    | Is there a free worker?                                       |
| `setNumWorkers(num)` | Sets the number of workers.                                   |
| `getNumWorkers()`    | Gets the number of workers.                                   |
| `work`               | Process an event off the queue if it can.                     |

By default, a stage's queue is a `NoQueue`: a queue with unlimited workers and size. All events are served immediately. The `NoQueue` serves as a good default when you don't want to place capacity or concurrency restrictions on the stage. In practice, queues are likely to be bounded. We've created several prebuilt bounded queues (such as `FIFOQueue` and `LIFOQueue`).

## Worker Pool

Workers are created, destroyed, and assigned work by the queue that contains them. A stage can influence the worker pool by calling methods on the queue itself, such as `queue.setNumWorkers(num)`.

_Note:_ The queues provided with the framework utilize workers that can only contain a single event. To handle multiple events being worked on by a single worker, you will need to create a custom queue and worker.

## Event

The event class wraps a required, public `key` property, which is just a string.

## Event Methods

The event methods on `Stage` are:

| Method           | Triggered On                              |
| ---------------- | ----------------------------------------- |
| `add(event)`     | An event enters the stage's queue.        |
| `workOn(event)`  | An event leaves the queue to be serviced. |
| `success(event)` | An event's `workOn()` succeeded.          |
| `fail(event)`    | An event's `workOn()` failed.             |

The framework's `Stage` class is abstract. Some of these event methods have default behavior, specified below.

| Method           | Default Behavior              |
| ---------------- | ----------------------------- |
| `add(event)`     | Rejects if the queue is full. |
| `workOn(event)`  | None.                         |
| `success(event)` | Always returns `"success"`.   |
| `fail(event)`    | Always throws `"fail"`.       |

As an event flows through a stage these event methods are triggered. To interrupt the flow and prevent an event from triggering additional methods, any method can `throw` an error or return a Promise which rejects. This is demonstrated in `add(event)`'s default implementation:

```typescript
protected async add(event: Event): Promise<void> {
  if (this.inQueue.isFull()) {
    return Promise.reject("fail");
  }
}
```

If an event finishes without throwing an error or returning a rejected promise, the event will continue to flow through the stage. The framework's goal is to distill all stages down into a `success` or a `fail`. An event that passes through a stage without throwing an error, regardless of the actual data returned and operations performed, results in a `success`. Likewise, an event that passes through a stage that results in a rejected Promise or thrown error, regardless of the actual error thrown or rejected promise reason, results in a `fail`.

## Simulation

The framework comes with a `Simulation` class to handle work we expect to be common among users of the framework. The simulation class drives creating events and sending them to a stage at a specified stage. You can control the distribution of keys using the simulation and the rate at which they arrive at the stage. An instance is available globally by importing `simulation`.

Most programs will use the simulation like this:

```typescript
// set up various stages

work();
async function work() {
  const events = await simulation.run(stages, 20000);

  // perform various analysis
}
```

## Timing

In this framework, the activity of all stages is coordinated using the abstract notion of time referred to as a _tick_. This increases the speed at which simulations occur and helps decouple the simulation from hardware (and software) limitations.

The framework includes the `Metronome` class which provides this abstraction. An instance is available globally by importing `metronome`. The global metronome class drives all timing parts of the simulation. When using the framework's suggested `simulation.run(...)`, the metronome is automatically started. To start it manually, you can use `metronome.start()`.

The `Metronome` class exposes a `setTimeout(func, ticks)` and `setInterval(func, ticks)`. Some convenience methods,such as `wait(ticks)`, are available to faciliate clean code.
