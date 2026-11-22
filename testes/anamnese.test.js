// Anamnese do autocadastro: validação, consentimento de saúde e o que o personal vê.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bancoFalso } from './banco-falso.js';
import { atenderApi } from '../src/api.js';
import { esquecerBanco } from '../lib/banco.js';
import { ANAMNESE, validarAnamnese, lerAnamnese } from '../lib/anamnese.js';

const completas = () => ({
  respostas: {
    objetivos: ['Emagrecer', 'Melhorar o condicionamento'],
    meta: 'Perder peso',
    experiencia: 'Parado há mais de 1 ano',
    atividades: ['Crossfit', 'Outra'],
    frequencia: '3',
    trabalho: 'Sentado quase o dia todo',
    sono: '6 a 7 h',
    descanso: 'Às vezes',
    estresse: 'Alto',
    lesao: 'Sim',
    condicoes: ['Pressão alta', 'Outra'],
    sinais: 'Não',
    remedio: 'Sim',
    liberacao: 'Meu médico pediu cautela',
    personalidade: 'Mais reservado',
    conversa: 'Foco total, pouca conversa',
    motivacao: ['Ver números evoluindo (carga, medidas)', 'Ser desafiado'],
    aperta: 'Incentive com calma',
    previsivel: 'Gosto de saber antes',
    faltas: ['Cansaço'],
    importante: ['Acompanhar minha evolução'],
    jaTreina: 'Sim',
    melhorar: ['Mais variedade'],
  },
  detalhes: { meta: '8', atividades: 'Beach tennis', lesao: 'Joelho direito, cirurgia de menisco em 2024, faço fisioterapia', condicoes: 'Hipotireoidismo', remedio: 'Losartana', melhorar: 'Treinos de fim de semana' },
  consentimentoSaude: true,
});

test('roteiro: Crossfit nas atividades, lesão só com descrição e "Outra" com campo', () => {
  const perguntas = ANAMNESE.flatMap((e) => e.perguntas);
  const ids = perguntas.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'ids únicos');
  const atividades = perguntas.find((p) => p.id === 'atividades');
  assert.ok(atividades.opcoes.includes('Crossfit'));
  assert.equal(atividades.texto, 'Faz outras atividades físicas?');
  assert.deepEqual(atividades.detalhe.quando, ['Outra']);
  const lesao = perguntas.find((p) => p.id === 'lesao');
  assert.equal(lesao.tipo, 'simnao');
  assert.equal(lesao.detalhe.obrigatorio, true);
  assert.equal(perguntas.find((p) => p.id === 'objetivos').tipo, 'varios');
  assert.equal(perguntas.find((p) => p.id === 'condicoes').detalhe.obrigatorio, true);
  assert.ok(!ids.includes('corrigido') && !ids.includes('musica'));
});

test('validação: respostas completas, campos obrigatórios e limites', () => {
  const ok = validarAnamnese(completas());
  assert.equal(ok.detalhes.meta, 8);
  assert.equal(ok.detalhes.lesao, 'Joelho direito, cirurgia de menisco em 2024, faço fisioterapia');
  assert.equal(ok.saude, true);

  const semDescricao = completas();
  delete semDescricao.detalhes.lesao;
  assert.throws(() => validarAnamnese(semDescricao), /Descreva/);

  const semOutra = completas();
  delete semOutra.detalhes.condicoes;
  assert.throws(() => validarAnamnese(semOutra), /Qual condição/);

  const demais = completas();
  demais.respostas.motivacao = ['Ser desafiado', 'Treino variado', 'Leveza e diversão'];
  assert.throws(() => validarAnamnese(demais), /no máximo 2/);

  const faltando = completas();
  delete faltando.respostas.frequencia;
  assert.throws(() => validarAnamnese(faltando), /Responda/);

  const semConsentimento = completas();
  semConsentimento.consentimentoSaude = false;
  assert.throws(() => validarAnamnese(semConsentimento), /autorização/);

  // Pular a saúde: nada de saúde é guardado, mesmo que venha no pedido
  const pulada = validarAnamnese({ ...completas(), consentimentoSaude: false, pularSaude: true });
  assert.equal(pulada.saude, false);
  assert.equal(pulada.respostas.lesao, undefined);
  assert.equal(pulada.detalhes.remedio, undefined);

  // "Melhorar" só vale para quem já treina com o personal
  const novo = completas();
  novo.respostas.jaTreina = 'Não';
  const r = validarAnamnese(novo);
  assert.equal(r.respostas.melhorar, undefined);
  assert.equal(r.detalhes.melhorar, undefined);

  // "Nenhuma" não convive com outras opções
  const nenhuma = completas();
  nenhuma.respostas.condicoes = ['Nenhuma', 'Diabetes'];
  delete nenhuma.detalhes.condicoes;
  assert.deepEqual(validarAnamnese(nenhuma).respostas.condicoes, ['Diabetes']);
});

test('leitura para o personal: alertas de saúde e resumo', () => {
  const a = lerAnamnese(JSON.stringify(validarAnamnese(completas())));
  assert.ok(a.alertas.some((t) => t.includes('Joelho direito')));
  assert.ok(a.alertas.some((t) => t.includes('cautela')));
  assert.ok(a.alertas.some((t) => t.includes('Pressão alta, Hipotireoidismo')));
  assert.ok(a.alertas.some((t) => t.includes('Losartana')));
  assert.equal(a.resumo, 'Emagrecer e Melhorar o condicionamento · 3x por semana · Mais reservado · Foco total, pouca conversa · motivado por ver números evoluindo (carga, medidas) e ser desafiado');
  const sinais = completas();
  sinais.respostas.sinais = 'Sim';
  assert.ok(lerAnamnese(JSON.stringify(validarAnamnese(sinais))).alertas[0].includes('liberação médica'));
});

test('autocadastro com anamnese aparece no painel e na ficha do aluno', async () => {
  esquecerBanco();
  const env = { DB: bancoFalso() };
  let cookie = '';
  const chamar = async (caminho, metodo = 'GET', dados) => {
    const url = 'https://renova.exemplo/api/' + caminho;
    const r = await atenderApi(new Request(url, { method: metodo, headers: { 'content-type': 'application/json', cookie }, body: dados ? JSON.stringify(dados) : undefined }), env, caminho.split('/'));
    const c = r.headers.get('set-cookie');
    if (c) cookie = c.split(';')[0];
    return { status: r.status, corpo: await r.json() };
  };
  await chamar('conta/criar', 'POST', { nome: 'Rafa Lima', email: 'rafa@exemplo.com', senha: 'senha-forte-1', slug: 'rafa' });
  const pessoal = cookie;

  cookie = '';
  let r = await chamar('convite/rafa');
  assert.equal(r.corpo.anamnese.length, 5);
  // Resposta incompleta é recusada com a pergunta que falta
  const incompleta = completas();
  delete incompleta.respostas.estresse;
  r = await chamar('convite/rafa', 'POST', { nome: 'Ana Souza', whatsapp: '62911112222', aceite: true, anamnese: incompleta });
  assert.equal(r.status, 400);
  assert.match(r.corpo.erro, /estresse/);
  r = await chamar('convite/rafa', 'POST', { nome: 'Ana Souza', whatsapp: '62911112222', aceite: true, anamnese: completas() });
  assert.equal(r.status, 200);
  // Quem abriu a página antiga (sem anamnese) ainda consegue se cadastrar
  r = await chamar('convite/rafa', 'POST', { nome: 'Bia Melo', whatsapp: '62933334444', aceite: true });
  assert.equal(r.status, 200);

  cookie = pessoal;
  r = await chamar('painel');
  const ana = r.corpo.alunos.find((x) => x.nome === 'Ana Souza');
  assert.equal(ana.anamnese.alertas.length, 4);
  assert.ok(ana.anamnese.resumo.startsWith('Emagrecer'));
  assert.equal(ana.anamnese.respostas, undefined, 'o painel recebe só o resumo');
  assert.equal(r.corpo.alunos.find((x) => x.nome === 'Bia Melo').anamnese, null);

  r = await chamar(`alunos/${ana.id}/mensalidades`);
  const etapas = r.corpo.anamnese.etapas;
  assert.deepEqual(etapas.map((e) => e.etapa), ['Seus objetivos', 'Histórico e rotina', 'Saúde', 'Seu jeito', 'As aulas']);
  const meta = etapas[0].itens.find((i) => i.pergunta.startsWith('Daqui a 12 meses'));
  assert.equal(meta.resposta, 'Perder peso (8 kg)');
  const lesao = etapas[2].itens.find((i) => i.pergunta.startsWith('Tem alguma lesão'));
  assert.equal(lesao.resposta, 'Sim: Joelho direito, cirurgia de menisco em 2024, faço fisioterapia');
  assert.ok(etapas[4].itens.some((i) => i.pergunta === 'O que você poderia melhorar?'));
  esquecerBanco();
});

test('o personal escolhe se o convite pede a anamnese', async () => {
  esquecerBanco();
  const env = { DB: bancoFalso() };
  let cookie = '';
  const chamar = async (caminho, metodo = 'GET', dados) => {
    const url = 'https://renova.exemplo/api/' + caminho;
    const r = await atenderApi(new Request(url, { method: metodo, headers: { 'content-type': 'application/json', cookie }, body: dados ? JSON.stringify(dados) : undefined }), env, caminho.split('/'));
    const c = r.headers.get('set-cookie');
    if (c) cookie = c.split(';')[0];
    return { status: r.status, corpo: await r.json() };
  };
  await chamar('conta/criar', 'POST', { nome: 'Rafa Lima', email: 'rafa@exemplo.com', senha: 'senha-forte-1', slug: 'rafa' });
  let r = await chamar('painel');
  assert.equal(r.corpo.personal.anamneseAtiva, true, 'ligada por padrão');
  assert.equal((await chamar('conta/anamnese', 'PUT', { ativa: 'talvez' })).status, 400);
  r = await chamar('conta/anamnese', 'PUT', { ativa: false });
  assert.equal(r.corpo.anamneseAtiva, false);
  assert.equal((await chamar('painel')).corpo.personal.anamneseAtiva, false);
  const pessoal = cookie;

  cookie = '';
  assert.deepEqual((await chamar('convite/rafa')).corpo.anamnese, []);
  // Mesmo que alguém mande respostas, com a anamnese desligada nada é guardado
  r = await chamar('convite/rafa', 'POST', { nome: 'Ana Souza', whatsapp: '62911112222', aceite: true, anamnese: completas() });
  assert.equal(r.status, 200);
  cookie = pessoal;
  assert.equal((await chamar('painel')).corpo.alunos[0].anamnese, null);

  await chamar('conta/anamnese', 'PUT', { ativa: true });
  cookie = '';
  assert.equal((await chamar('convite/rafa')).corpo.anamnese.length, 5);
  esquecerBanco();
});
