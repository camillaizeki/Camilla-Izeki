// Testa a API de ponta a ponta com um banco SQLite em memória no lugar do D1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoFalso } from './banco-falso.js';
import { atenderApi } from '../src/api.js';
import { crc16 } from '../lib/pix.js';
import { hojeBR, chaveMes, somaMes, dataISO } from '../lib/jornada.js';

const hoje = hojeBR();
const mesAtual = chaveMes(hoje.ano, hoje.mes);
const hojeISO = dataISO(hoje);

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

  // Administração: sem chave configurada fica desligada; com chave, gera código que funciona
  assert.equal((await chamar('admin/codigo', 'POST', { chave: 'qualquer', email: 'rafa@exemplo.com' }, false)).status, 503);
  env.ADMIN_KEY = 'chave-de-teste-bem-comprida-123';
  assert.equal((await chamar('admin/codigo', 'POST', { chave: 'chave-errada', email: 'rafa@exemplo.com' }, false)).status, 401);
  assert.equal((await chamar('admin/codigo', 'POST', { chave: env.ADMIN_KEY, email: 'ninguem@exemplo.com' }, false)).status, 404);
  r = await chamar('admin/codigo', 'POST', { chave: env.ADMIN_KEY, email: ' Rafa@Exemplo.com ' }, false);
  assert.equal(r.corpo.nome, 'Rafael Lima');
  assert.equal((await chamar('conta/redefinir', 'POST', { email: 'rafa@exemplo.com', codigo: r.corpo.codigo, senha: 'senha-nova-22' })).status, 200);

  // Configura o Pix
  r = await chamar('conta', 'PUT', { nome: 'Rafael Lima', pixTipo: 'celular', pixChave: '(11) 98888-7777', pixNome: 'Rafael Lima', pixCidade: 'São Paulo', valorPadrao: 25000, diaPadrao: 5, tom: 'zoeiro' });
  assert.equal(r.status, 200);
  r = await chamar('painel');
  assert.equal(r.corpo.personal.pixChave, '+5511988887777');
  assert.equal(r.corpo.frases.length, 6);

  // Convite público
  r = await chamar('convite/rafa', 'GET', null, false);
  assert.equal(r.corpo.personal.nome, 'Rafael Lima');
  assert.equal((await chamar('convite/naoexiste', 'GET', null, false)).status, 404);
  assert.equal((await chamar('convite/rafa', 'POST', { nome: 'Ana Souza', whatsapp: '123', aceite: true }, false)).status, 400);
  r = await chamar('convite/rafa', 'POST', { nome: 'Ana Souza', whatsapp: '(11) 97777-6666', aceite: true }, false);
  assert.equal(r.status, 200);
  const token = r.corpo.token;

  // WhatsApp repetido no mesmo personal é barrado, sem revelar o link do outro aluno
  r = await chamar('convite/rafa', 'POST', { nome: 'Ana Clone', whatsapp: '11 97777 6666', aceite: true }, false);
  assert.equal(r.status, 409);
  assert.equal(r.corpo.token, undefined);

  // Aluno novo vê a trilha, mas ainda não pode pagar
  r = await chamar('aluno/' + token, 'GET', null, false);
  assert.equal(r.corpo.nome, 'Ana');
  assert.equal(r.corpo.status, 'novo');
  assert.equal(r.corpo.pix, null);
  assert.equal((await chamar(`aluno/${token}/paguei`, 'POST', {}, false)).status, 400);

  // Personal confirma o cadastro, com a primeira mensalidade neste mês
  r = await chamar('painel');
  const ana = r.corpo.alunos[0];
  assert.equal(ana.status, 'novo');
  assert.equal(ana.filtro, 'novo');
  assert.equal(ana.whatsapp, '5511977776666');
  assert.equal((await chamar('alunos/' + ana.id, 'PUT', { valor: 25000, diaVenc: 28, baseMeses: 5, primeiroMes: 'atual' })).status, 200);

  // A mensalidade do mês nasce sozinha, pendente (ou atrasada, se hoje já passou do dia 28)
  const esperado = hoje.dia > 28 ? 'atrasado' : 'pendente';
  r = await chamar('painel');
  let a1 = r.corpo.alunos[0];
  assert.equal(a1.status, 'ativo');
  assert.equal(a1.abertas.length, 1);
  assert.equal(a1.abertas[0].mes, mesAtual);
  assert.equal(a1.abertas[0].situacao, esperado);
  assert.equal(a1.abertas[0].valor, 25000);
  assert.equal(a1.filtro, esperado);
  assert.equal(r.corpo.resumo[esperado], 25000);
  assert.equal(r.corpo.resumo.recebido, 0);
  assert.equal((await chamar('painel')).corpo.alunos[0].abertas.length, 1); // abrir de novo não duplica

  // O aluno tem Pix válido e avisa que pagou; isso não entra no faturamento
  r = await chamar('aluno/' + token, 'GET', null, false);
  assert.equal(r.corpo.meses, 5);
  assert.ok(r.corpo.pix.includes('+5511988887777'));
  assert.ok(r.corpo.pix.includes('5406250.00'));
  assert.equal(crc16(r.corpo.pix.slice(0, -4)), r.corpo.pix.slice(-4));
  assert.ok(r.corpo.frases.every((f) => !f.includes('{personal}')));
  assert.equal((await chamar(`aluno/${token}/paguei`, 'POST', {}, false)).status, 200);
  assert.equal((await chamar(`aluno/${token}/paguei`, 'POST', {}, false)).status, 200); // repetir não quebra
  r = await chamar('painel');
  assert.equal(r.corpo.alunos[0].situacao, 'informado');
  assert.equal(r.corpo.alunos[0].abertas[0].informado, true);
  assert.equal(r.corpo.resumo.recebido, 0);

  // Personal marca como pago em um toque: entra no recebido do mês e a trilha anda
  assert.equal((await chamar(`alunos/${ana.id}/mensalidades/${mesAtual}`, 'POST', { acao: 'pagar' })).status, 200);
  r = await chamar('painel');
  assert.equal(r.corpo.resumo.recebido, 25000);
  assert.equal(r.corpo.resumo.pendente + r.corpo.resumo.atrasado, 0);
  assert.equal(r.corpo.alunos[0].filtro, 'pago');
  assert.equal(r.corpo.alunos[0].abertas.length, 0);
  const fin = r.corpo.financeiro;
  assert.equal(fin.meses.length, 12);
  assert.deepEqual([fin.meses.at(-1).mes, fin.meses.at(-1).recebido, fin.meses.at(-1).previsto, fin.meses.at(-1).pagas, fin.meses.at(-1).total], [mesAtual, 25000, 25000, 1, 1]);
  assert.deepEqual([fin.aVencer, fin.emAtraso], [0, 0]);
  assert.deepEqual(fin.alunos, { ativos: 1, pausados: 0, inadimplentes: 0, inativos: 0 });
  r = await chamar('aluno/' + token, 'GET', null, false);
  assert.equal(r.corpo.meses, 6);
  assert.equal(r.corpo.selo.nome, 'Ouro');

  // Marcar de novo não conta duas vezes; dá para corrigir valor e data
  await chamar(`alunos/${ana.id}/mensalidades/${mesAtual}`, 'POST', { acao: 'pagar' });
  assert.equal((await chamar('painel')).corpo.resumo.recebido, 25000);
  assert.equal((await chamar(`alunos/${ana.id}/mensalidades/${mesAtual}`, 'POST', { acao: 'pagar', valor: 20000, data: hojeISO })).status, 200);
  assert.equal((await chamar('painel')).corpo.resumo.recebido, 20000);
  assert.equal((await chamar(`alunos/${ana.id}/mensalidades/${mesAtual}`, 'POST', { acao: 'pagar', data: '2999-01-01' })).status, 400);

  // Mensalidade de mês anterior recebida hoje entra no faturamento de hoje
  const mesPassado = somaMes(mesAtual, -1);
  assert.equal((await chamar(`alunos/${ana.id}/mensalidades/${mesPassado}`, 'POST', { acao: 'pagar', valor: 25000 })).status, 200);
  assert.equal((await chamar('painel')).corpo.resumo.recebido, 45000);
  assert.equal((await chamar('aluno/' + token, 'GET', null, false)).corpo.meses, 6); // mês antigo lançado não aumenta a trilha
  r = await chamar(`alunos/${ana.id}/mensalidades`);
  assert.deepEqual(r.corpo.mensalidades.map((m) => m.mes), [mesAtual, mesPassado]);
  assert.equal(r.corpo.mensalidades[0].valorRecebido, 20000);
  assert.equal(r.corpo.mensalidades[0].recebidoEm, hojeISO);

  // Reabrir desfaz o pagamento; dispensar tira a mensalidade da conta
  await chamar(`alunos/${ana.id}/mensalidades/${mesPassado}`, 'POST', { acao: 'dispensar' });
  await chamar(`alunos/${ana.id}/mensalidades/${mesAtual}`, 'POST', { acao: 'reabrir' });
  r = await chamar('painel');
  assert.equal(r.corpo.resumo.recebido, 0);
  assert.equal(r.corpo.alunos[0].abertas.length, 1);
  assert.equal(r.corpo.alunos[0].filtro, esperado);

  // Mudar o valor atualiza a mensalidade que ainda está no prazo
  await chamar('alunos/' + ana.id, 'PUT', { valor: 30000, diaVenc: 28 });
  r = await chamar('painel');
  if (esperado === 'pendente') assert.equal(r.corpo.alunos[0].abertas[0].valor, 30000);
  assert.equal(r.corpo.alunos[0].valor, 30000);

  // Lembrete marcado
  assert.equal((await chamar(`alunos/${ana.id}/lembrado`, 'POST', {})).status, 200);
  assert.equal((await chamar('painel')).corpo.alunos[0].lembradoHoje, true);

  // Pausa sem cobrança: a mensalidade em aberto que vence dentro dela deixa de ser devida
  assert.equal((await chamar(`alunos/${ana.id}/pausas`, 'POST', { inicio: '2020-13-40' })).status, 400);
  assert.equal((await chamar(`alunos/${ana.id}/pausas`, 'POST', { inicio: mesAtual + '-01', cobrar: false })).status, 200);
  r = await chamar('painel');
  a1 = r.corpo.alunos[0];
  assert.equal(a1.emPausa, true);
  assert.equal(a1.filtro, 'pausado');
  assert.equal(a1.abertas.length, 0);
  assert.equal(a1.pausas.length, 1);
  assert.equal((await chamar('aluno/' + token, 'GET', null, false)).corpo.status, 'pausado');
  assert.equal((await chamar(`alunos/${ana.id}/pausas`, 'POST', { inicio: mesAtual + '-10' })).status, 400); // sobreposta

  // Pausa com cobrança mantém a mensalidade; apagar a pausa também devolve
  await chamar(`alunos/${ana.id}/pausas/${a1.pausas[0].id}`, 'PUT', { inicio: mesAtual + '-01', cobrar: true });
  assert.equal((await chamar('painel')).corpo.alunos[0].abertas.length, 1);
  await chamar(`alunos/${ana.id}/pausas/${a1.pausas[0].id}`, 'PUT', { inicio: mesAtual + '-01', cobrar: false });
  assert.equal((await chamar('painel')).corpo.alunos[0].abertas.length, 0);
  await chamar(`alunos/${ana.id}/pausas/${a1.pausas[0].id}`, 'DELETE');
  r = await chamar('painel');
  assert.equal(r.corpo.alunos[0].emPausa, false);
  assert.equal(r.corpo.alunos[0].abertas.length, 1);

  // Inativo: sai dos filtros de cobrança e não gera mensalidade nova
  await chamar('alunos/' + ana.id, 'PUT', { valor: 30000, diaVenc: 28, status: 'inativo' });
  assert.equal((await chamar('painel')).corpo.alunos[0].filtro, 'inativo');
  await chamar('alunos/' + ana.id, 'PUT', { valor: 30000, diaVenc: 28, status: 'ativo' });

  // Cadastro feito pelo próprio personal, com a primeira mensalidade só no mês que vem
  assert.equal((await chamar('alunos', 'POST', { nome: 'Xu', whatsapp: '11977776666', valor: 20000, diaVenc: 10 })).status, 409); // duplicado
  r = await chamar('alunos', 'POST', { nome: 'Bruno Lima', whatsapp: '(11) 96666-5555', valor: 20000, diaVenc: 10, dataInicio: mesPassado + '-01', primeiroMes: 'proximo' });
  assert.equal(r.status, 200);
  r = await chamar('painel');
  const bruno = r.corpo.alunos.find((x) => x.nome === 'Bruno Lima');
  assert.equal(bruno.status, 'ativo');
  assert.equal(bruno.abertas.length, 0);
  assert.equal(bruno.filtro, 'em_dia');
  assert.equal(bruno.meses, 2); // mês passado e este, antes da primeira mensalidade controlada
  assert.equal(bruno.dataInicio, mesPassado + '-01');
  assert.equal((await chamar('alunos/' + bruno.id, 'PUT', { valor: 20000, diaVenc: 10, whatsapp: '11977776666' })).status, 409);
  assert.equal((await chamar('alunos/' + bruno.id, 'PUT', { valor: 20000, diaVenc: 10, nome: 'Bruno L. Lima' })).status, 200);

  // Outro personal não mexe no aluno do Rafa
  const cookieRafa = cookie;
  await chamar('conta/criar', 'POST', { nome: 'Bia', email: 'bia@exemplo.com', senha: 'senha-forte-2', slug: 'bia' });
  assert.equal((await chamar('alunos/' + ana.id, 'DELETE')).status, 404);
  assert.equal((await chamar(`alunos/${ana.id}/mensalidades`)).status, 404);
  assert.equal((await chamar(`alunos/${ana.id}/mensalidades/${mesAtual}`, 'POST', { acao: 'pagar' })).status, 404);
  assert.equal((await chamar('painel')).corpo.alunos.length, 0);
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
