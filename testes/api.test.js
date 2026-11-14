// Testa a API de ponta a ponta com um banco SQLite em memória no lugar do D1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { atenderApi } from '../src/api.js';
import { crc16 } from '../lib/pix.js';

function bancoFalso() {
  const sqlite = new DatabaseSync(':memory:');
  const preparar = (sql, valores = []) => ({
    bind: (...v) => preparar(sql, v.map((x) => (x === undefined ? null : x))),
    first: async () => sqlite.prepare(sql).get(...valores) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...valores) }),
    run: async () => {
      const r = sqlite.prepare(sql).run(...valores);
      return { meta: { last_row_id: Number(r.lastInsertRowid) } };
    },
  });
  return { prepare: (sql) => preparar(sql), batch: async (lista) => Promise.all(lista.map((p) => p.run())) };
}

const env = { DB: bancoFalso() };
let cookie = '';

async function chamar(caminho, metodo = 'GET', dados, comCookie = true) {
  const request = new Request('https://teste.local/api/' + caminho, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(comCookie && cookie ? { cookie } : {}) },
    body: dados ? JSON.stringify(dados) : undefined,
  });
  const resposta = await atenderApi(request, env, caminho.split('/'));
  const definido = resposta.headers.get('set-cookie');
  if (definido) cookie = definido.split(';')[0];
  const tipo = resposta.headers.get('content-type') || '';
  return { status: resposta.status, corpo: tipo.includes('json') ? await resposta.json() : await resposta.arrayBuffer() };
}

test('fluxo completo: personal, aluno, renovação, frases, foto e IA', async () => {
  // Painel exige login
  assert.equal((await chamar('painel')).status, 401);

  // Cria a conta
  let r = await chamar('conta/criar', 'POST', { nome: 'Rafael Lima', email: 'Rafa@Exemplo.com', senha: 'senha-forte-1', slug: 'rafa' });
  assert.equal(r.status, 200);
  assert.ok(cookie.startsWith('sessao='));
  const codigo = r.corpo.codigo;
  assert.match(codigo, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal((await chamar('conta/criar', 'POST', { nome: 'Outro', email: 'rafa@exemplo.com', senha: 'senha-forte-1', slug: 'outro' })).status, 400);
  assert.equal((await chamar('conta/criar', 'POST', { nome: 'Outro', email: 'o@exemplo.com', senha: 'senha-forte-1', slug: 'api' })).status, 400);

  // Sai e entra de novo
  await chamar('conta/sair', 'POST', {});
  assert.equal((await chamar('painel')).status, 401);
  assert.equal((await chamar('conta/entrar', 'POST', { email: 'rafa@exemplo.com', senha: 'errada-123' })).status, 401);
  assert.equal((await chamar('conta/entrar', 'POST', { email: 'rafa@exemplo.com', senha: 'senha-forte-1' })).status, 200);

  // Esqueci minha senha: código errado não passa; o certo troca a senha e gera outro código
  await chamar('conta/sair', 'POST', {});
  assert.equal((await chamar('conta/redefinir', 'POST', { email: 'rafa@exemplo.com', codigo: 'AAAA-AAAA-AAAA', senha: 'senha-nova-22' })).status, 401);
  assert.equal((await chamar('conta/redefinir', 'POST', { email: 'ninguem@exemplo.com', codigo, senha: 'senha-nova-22' })).status, 401);
  r = await chamar('conta/redefinir', 'POST', { email: 'rafa@exemplo.com', codigo: codigo.toLowerCase().replaceAll('-', ' '), senha: 'senha-nova-22' });
  assert.equal(r.status, 200);
  const codigo2 = r.corpo.codigo;
  assert.notEqual(codigo2, codigo);
  assert.equal((await chamar('painel')).status, 200);
  await chamar('conta/sair', 'POST', {});
  assert.equal((await chamar('conta/redefinir', 'POST', { email: 'rafa@exemplo.com', codigo, senha: 'senha-outra-33' })).status, 401); // código usado não vale mais
  assert.equal((await chamar('conta/entrar', 'POST', { email: 'rafa@exemplo.com', senha: 'senha-forte-1' })).status, 401);
  assert.equal((await chamar('conta/entrar', 'POST', { email: 'rafa@exemplo.com', senha: 'senha-nova-22' })).status, 200);
  r = await chamar('conta/recuperacao', 'POST', {});
  assert.notEqual(r.corpo.codigo, codigo2);
  assert.equal((await chamar('painel')).corpo.personal.temCodigo, true);

  // Configura o Pix
  r = await chamar('conta', 'PUT', { nome: 'Rafael Lima', pixTipo: 'celular', pixChave: '(11) 98888-7777', pixNome: 'Rafael Lima', pixCidade: 'São Paulo', valorPadrao: 25000, diaPadrao: 5, tom: 'zoeiro' });
  assert.equal(r.status, 200);
  r = await chamar('painel');
  assert.equal(r.corpo.personal.pixChave, '+5511988887777');
  assert.equal(r.corpo.frases.length, 6);

  // Convite público
  r = await chamar('convite/rafa', 'GET', null, false);
  assert.equal(r.corpo.personal.primeiroNome, 'Rafael');
  assert.equal((await chamar('convite/naoexiste', 'GET', null, false)).status, 404);
  assert.equal((await chamar('convite/rafa', 'POST', { nome: 'Ana Souza', whatsapp: '123', aceite: true }, false)).status, 400);
  r = await chamar('convite/rafa', 'POST', { nome: 'Ana Souza', whatsapp: '(11) 97777-6666', aceite: true }, false);
  assert.equal(r.status, 200);
  const token = r.corpo.token;

  // Aluno novo vê a trilha, mas ainda não pode pagar
  r = await chamar('aluno/' + token, 'GET', null, false);
  assert.equal(r.corpo.nome, 'Ana');
  assert.equal(r.corpo.status, 'novo');
  assert.equal(r.corpo.pix, null);
  assert.equal((await chamar(`aluno/${token}/paguei`, 'POST', {}, false)).status, 400);

  // Personal confirma o cadastro
  r = await chamar('painel');
  const ana = r.corpo.alunos[0];
  assert.equal(ana.status, 'novo');
  assert.equal(ana.whatsapp, '5511977776666');
  assert.equal((await chamar('alunos/' + ana.id, 'PUT', { valor: 25000, diaVenc: 5, baseMeses: 5, status: 'ativo' })).status, 200);

  // Agora o aluno tem Pix válido
  r = await chamar('aluno/' + token, 'GET', null, false);
  assert.equal(r.corpo.meses, 5);
  assert.ok(r.corpo.pix.includes('+5511988887777'));
  assert.ok(r.corpo.pix.includes('5406250.00'));
  assert.equal(crc16(r.corpo.pix.slice(0, -4)), r.corpo.pix.slice(-4));
  assert.ok(r.corpo.frases.every((f) => !f.includes('{personal}')));

  // Aluno informa o pagamento; personal confirma
  assert.equal((await chamar(`aluno/${token}/paguei`, 'POST', {}, false)).status, 200);
  assert.equal((await chamar(`aluno/${token}/paguei`, 'POST', {}, false)).status, 200); // repetir não quebra
  r = await chamar('painel');
  assert.equal(r.corpo.alunos[0].situacao, 'informado');
  assert.equal((await chamar(`alunos/${ana.id}/pagamento`, 'POST', { acao: 'confirmar' })).status, 200);
  r = await chamar('aluno/' + token, 'GET', null, false);
  assert.equal(r.corpo.meses, 6);
  assert.equal(r.corpo.selo.nome, 'Ouro');

  // Lembrete marcado, pausa e reativação
  assert.equal((await chamar(`alunos/${ana.id}/lembrado`, 'POST', {})).status, 200);
  assert.equal((await chamar('painel')).corpo.alunos[0].lembradoHoje, true);
  await chamar('alunos/' + ana.id, 'PUT', { valor: 25000, diaVenc: 5, baseMeses: 5, status: 'pausado' });
  assert.equal((await chamar('painel')).corpo.alunos[0].situacao, 'pausado');

  // Outro personal não mexe no aluno do Rafa
  const cookieRafa = cookie;
  await chamar('conta/criar', 'POST', { nome: 'Bia', email: 'bia@exemplo.com', senha: 'senha-forte-2', slug: 'bia' });
  assert.equal((await chamar('alunos/' + ana.id, 'DELETE')).status, 404);
  cookie = cookieRafa;

  // Frases
  assert.equal((await chamar('frases', 'POST', { texto: 'Treino pago, desculpa esgotada.' })).status, 200);
  r = await chamar('painel');
  const ultima = r.corpo.frases.at(-1);
  assert.equal(ultima.origem, 'propria');
  await chamar('frases/' + ultima.id, 'PUT', { ativa: false });
  r = await chamar('aluno/' + token, 'GET', null, false);
  assert.ok(!r.corpo.frases.includes('Treino pago, desculpa esgotada.'));
  await chamar('frases/' + ultima.id, 'DELETE');
  assert.equal((await chamar('painel')).corpo.frases.length, 6);

  // Foto
  const foto = 'data:image/jpeg;base64,' + Buffer.from([255, 216, 255, 217]).toString('base64');
  assert.equal((await chamar('foto', 'PUT', { foto })).status, 200);
  r = await chamar('foto/rafa', 'GET', null, false);
  assert.deepEqual([...new Uint8Array(r.corpo)], [255, 216, 255, 217]);
  assert.equal((await chamar('foto', 'PUT', { foto: 'data:text/html;base64,AAAA' })).status, 400);

  // IA: sem o serviço ligado avisa; com ele, devolve frases limpas e lembrete
  assert.equal((await chamar('ia/frases', 'POST', { tom: 'zoeiro' })).status, 503);
  env.AI = { run: async () => ({ response: '1. "Mais um mês e o Rafael ainda me aguenta"\n- Sobrevivi a mais 30 dias de agachamento\n\ncurta' }) };
  r = await chamar('ia/frases', 'POST', { tom: 'zoeiro' });
  assert.deepEqual(r.corpo.frases, ['Mais um mês e o Rafael ainda me aguenta', 'Sobrevivi a mais 30 dias de agachamento']);
  env.AI = { run: async () => ({ response: '"Ana, sua jornada segue firme!"' }) };
  r = await chamar('ia/lembrete', 'POST', { alunoId: ana.id });
  assert.equal(r.corpo.texto, 'Ana, sua jornada segue firme!');

  // Excluir aluno
  assert.equal((await chamar('alunos/' + ana.id, 'DELETE')).status, 200);
  assert.equal((await chamar('aluno/' + token, 'GET', null, false)).status, 404);
});

test('entrada do Worker encaminha API, links bonitos e arquivos', async () => {
  const { default: worker } = await import('../src/worker.js');
  const pedidos = [];
  const ambiente = {
    ...env,
    ASSETS: {
      fetch: async (req) => {
        pedidos.push(new URL(req.url).pathname);
        return new Response('arquivo');
      },
    },
  };
  const ir = (caminho) => worker.fetch(new Request('https://teste.local' + caminho), ambiente);
  assert.equal((await ir('/api/painel')).status, 401);
  await ir('/c/rafa');
  await ir('/a/abc123');
  await ir('/painel');
  await ir('/estilo.css');
  assert.deepEqual(pedidos, ['/convite', '/aluno', '/painel', '/estilo.css']);
});
