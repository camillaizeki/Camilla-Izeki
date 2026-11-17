// Banco SQLite em memória com a mesma interface do Cloudflare D1, para testes.
import { DatabaseSync } from 'node:sqlite';

export function bancoFalso() {
  const sqlite = new DatabaseSync(':memory:');
  const preparar = (sql, valores = []) => ({
    bind: (...v) => preparar(sql, v.map((x) => (x === undefined ? null : x))),
    first: async () => sqlite.prepare(sql).get(...valores) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...valores) }),
    run: async () => {
      const r = sqlite.prepare(sql).run(...valores);
      return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
    },
  });
  return {
    sqlite,
    prepare: (sql) => preparar(sql),
    // Como no D1, um lote é tudo ou nada.
    batch: async (lista) => {
      sqlite.exec('BEGIN');
      try {
        const saida = [];
        for (const p of lista) saida.push(await p.run());
        sqlite.exec('COMMIT');
        return saida;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
