
type Table = Record<string, Line>;
type Line = {
  value: number;
  called: number;
}
class Stats {
  private table: Table = {};

  add(name: string, value: number) {
    if (!this.table[name]) {
      this.table[name] = { value: 0, called: 1 };
    }

    const existing = this.table[name]
    existing.value += value;
    existing.called++;
  }

  summary(): void {
    console.log("Stats tracked through the global stats instance")
    const virtual: Table = JSON.parse(JSON.stringify(this.table))

    for (const [key, line] of Object.entries(virtual)) {
      const row = line as any;
      row.avg = line.called > 0 ? (line.value / line.called).toFixed(3) : 0
    }
    console.table(virtual);
  }
}




export const stats = new Stats();