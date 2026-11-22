// Garante que os dados da primeira versão são convertidos sem perda.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoFalso } from './banco-falso.js';
import { prepararBanco, esquecerBanco } from '../lib/banco.js';

test('banco da primeira versão é convertido para o controle de mensalidades', async () => {
  const db = bancoFalso();
  // Estrutura exatamente como estava publicada antes desta evolução.
  db.sqlite.exec(`
    CREATE TABLE personais (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, nome TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL, senha_sal TEXT NOT NULL, pix_tipo TEXT, pix_chave TEXT, pix_nome TEXT, pix_cidade TEXT, valor_padrao INTEGER,
      dia_padrao INTEGER DEFAULT 5, tom TEXT DEFAULT 'zoeiro', foto TEXT, criado_em TEXT NOT NULL, recuperacao_hash TEXT);
    CREATE TABLE sessoes (token TEXT PRIMARY KEY, personal_id INTEGER NOT NULL, expira_em INTEGER NOT NULL);
    CREATE TABLE alunos (id INTEGER PRIMARY KEY AUTOINCREMENT, personal_id INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, nome TEXT NOT NULL,
      whatsapp TEXT NOT NULL, mes_inicio TEXT, meses_pausa INTEGER DEFAULT 0, base_meses INTEGER NOT NULL DEFAULT 1, seq_base INTEGER NOT NULL DEFAULT 0,
      mes_cadastro TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'novo', valor INTEGER, dia_venc INTEGER, lembrado_em TEXT, criado_em TEXT NOT NULL);
    CREATE TABLE pagamentos (id INTEGER PRIMARY KEY AUTOINCREMENT, aluno_id INTEGER NOT NULL, mes TEXT NOT NULL, status TEXT NOT NULL,
      informado_em TEXT, confirmado_em TEXT, UNIQUE (aluno_id, mes));
    CREATE TABLE frases (id INTEGER PRIMARY KEY AUTOINCREMENT, personal_id INTEGER NOT NULL, texto TEXT NOT NULL, ativa INTEGER NOT NULL DEFAULT 1, origem TEXT NOT NULL DEFAULT 'padrao');
    INSERT INTO personais (slug, nome, email, senha_hash, senha_sal, criado_em) VALUES ('rafa', 'Rafa', 'rafa@exemplo.com', 'h', 's', '2026-11-14');
    INSERT INTO alunos (personal_id, token, nome, whatsapp, mes_inicio, base_meses, seq_base, mes_cadastro, status, valor, dia_venc, criado_em) VALUES
      (1, 't1', 'Ana', '5511911111111', '2026-07', 5, 5, '2026-11', 'ativo', 25000, 5, '2026-11-14'),
      (1, 't2', 'Carla', '5511922222222', NULL, 1, 1, '2026-12', 'pausado', 30000, 10, '2026-12-02'),
      (1, 't3', 'Novo', '5511933333333', NULL, 1, 1, '2026-11', 'novo', NULL, 5, '2026-11-14'),
      (1, 't4', 'Dani', '5511944444444', NULL, 3, 3, '2026-11', 'ativo', 20000, 10, '2026-11-14T20:00:00.000Z');
    INSERT INTO pagamentos (aluno_id, mes, status, informado_em, confirmado_em) VALUES
      (1, '2026-12', 'confirmado', NULL, '2026-12-04T13:00:00.000Z'),
      (1, '2027-01', 'informado', '2027-01-05T10:00:00.000Z', NULL);
  `);

  esquecerBanco();
  await prepararBanco(db);
  const um = (sql) => db.sqlite.prepare(sql).get();

  // Alunos e pagamentos continuam todos lá
  assert.equal(um('SELECT COUNT(*) AS n FROM alunos').n, 4);
  assert.equal(um('SELECT COUNT(*) AS n FROM pagamentos').n, 2);

  // Quem já existia antes do controle mensal passa a ser controlado desde o mês do cadastro,
  // para esse mês não ficar sem mensalidade
  assert.deepEqual({ ...um('SELECT mes_controle, data_inicio, status, base_meses FROM alunos WHERE id = 1') }, { mes_controle: '2026-11', data_inicio: '2026-07-01', status: 'ativo', base_meses: 5 });
  // Sem data de início, o mês do cadastro sai da contagem guardada (volta quando for pago)
  assert.deepEqual({ ...um('SELECT mes_controle, base_meses, seq_base FROM alunos WHERE id = 4') }, { mes_controle: '2026-11', base_meses: 2, seq_base: 2 });
  // Cadastro posterior a essa mudança não é alterado
  assert.equal(um('SELECT mes_controle FROM alunos WHERE id = 2').mes_controle, '2027-01');
  assert.equal(um('SELECT mes_controle FROM alunos WHERE id = 3').mes_controle, null); // "novo" define ao ser confirmado

  // "Pausado" vira uma pausa em aberto, sem cobrança
  assert.equal(um('SELECT status FROM alunos WHERE id = 2').status, 'ativo');
  const pausa = um('SELECT aluno_id, fim, cobrar FROM pausas');
  assert.deepEqual({ ...pausa }, { aluno_id: 2, fim: null, cobrar: 0 });

  // Pagamento confirmado ganha valor e data de recebimento; o informado segue em aberto
  assert.deepEqual(
    { ...um("SELECT valor_previsto, vencimento, recebido_em, valor_recebido FROM pagamentos WHERE mes = '2026-12'") },
    { valor_previsto: 25000, vencimento: '2026-12-05', recebido_em: '2026-12-04', valor_recebido: 25000 }
  );
  assert.deepEqual(
    { ...um("SELECT valor_previsto, vencimento, recebido_em FROM pagamentos WHERE mes = '2027-01'") },
    { valor_previsto: 25000, vencimento: '2027-01-05', recebido_em: null }
  );

  assert.equal(um("SELECT valor FROM meta WHERE chave = 'versao'").valor, '6');

  // Versão 5: contas que já existiam ganham 7 dias de teste a partir da atualização
  const conta = um('SELECT plano, acesso_ate FROM personais LIMIT 1');
  assert.equal(conta.plano, 'teste');
  const dias = (Date.parse(conta.acesso_ate) - Date.now()) / 86400000;
  assert.ok(dias > 6.9 && dias <= 7, 'teste de 7 dias para quem já tinha conta');

  // Rodar de novo não repete a conversão (não cria outra pausa nem desconta outro mês)
  esquecerBanco();
  await prepararBanco(db);
  assert.equal(um('SELECT COUNT(*) AS n FROM pausas').n, 1);
  assert.equal(um('SELECT base_meses FROM alunos WHERE id = 4').base_meses, 2);
  esquecerBanco();
});

test('banco que já estava na versão 2 recebe só o ajuste do mês do cadastro', async () => {
  const db = bancoFalso();
  esquecerBanco();
  await prepararBanco(db); // banco novo, já na versão atual
  db.sqlite.exec(`
    UPDATE meta SET valor = '2' WHERE chave = 'versao';
    INSERT INTO personais (slug, nome, email, senha_hash, senha_sal, criado_em) VALUES ('rafa', 'Rafa', 'rafa@exemplo.com', 'h', 's', '2026-11-14');
    INSERT INTO alunos (personal_id, token, nome, whatsapp, mes_inicio, data_inicio, base_meses, seq_base, mes_cadastro, mes_controle, status, valor, dia_venc, criado_em) VALUES
      (1, 't1', 'Camilla', '5562900000000', '2026-01', '2026-01-01', 11, 11, '2026-11', '2026-12', 'ativo', 60000, 10, '2026-11-14T22:00:00.000Z'),
      (1, 't2', 'Proximo', '5562911111111', NULL, NULL, 1, 1, '2026-11', '2026-12', 'ativo', 60000, 10, '2026-11-15T17:00:00.000Z');
    INSERT INTO pagamentos (aluno_id, mes, status, valor_previsto, vencimento, informado_em) VALUES (1, '2026-12', 'informado', 60000, '2026-12-10', '2026-11-15T17:05:00.000Z');
  `);
  esquecerBanco();
  await prepararBanco(db);
  const um = (sql) => db.sqlite.prepare(sql).get();
  assert.equal(um('SELECT mes_controle FROM alunos WHERE id = 1').mes_controle, '2026-11');
  assert.equal(um('SELECT mes_controle FROM alunos WHERE id = 2').mes_controle, '2026-12'); // escolheu "No mês que vem" depois da mudança
  assert.equal(um('SELECT COUNT(*) AS n FROM pagamentos').n, 1); // o aviso de dezembro continua lá
  esquecerBanco();
});
