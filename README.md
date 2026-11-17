# Renova.AI

Renovação de mensalidade para personal trainers, sem cara de cobrança.
O aluno acompanha uma trilha de meses de treino, desbloqueia cada mês por Pix e compartilha a conquista.
O personal acompanha tudo em um painel e envia lembretes pelo próprio WhatsApp.

## Como funciona

- **Personal:** cria a conta em `/painel`, cadastra a chave Pix e os alunos, ou envia o link de convite (`/c/seu-link`).
- **Aluno:** se cadastra pelo convite com nome e WhatsApp e ganha um link pessoal (`/a/código`), sem senha.
- **Controle mensal:** cada aluno ativo ganha uma mensalidade por mês, com valor previsto e vencimento. No painel ela aparece como paga, pendente, atrasada ou em pausa.
- **Recebimento:** o personal marca como pago em um toque, e pode ajustar a data e o valor. O faturamento usa a data real do recebimento, e cada mensalidade tem um único registro.
- **Dashboard:** a tela Início mostra o recebido no mês, o previsto, o que falta vencer, o que está em atraso e a contagem de alunos ativos, pausados e inadimplentes, com navegação pelos últimos 12 meses.
- **Pagamento adiantado:** dá para lançar um ou vários meses futuros de uma vez. O valor entra no faturamento do dia em que foi recebido, o mês futuro já aparece como pago, e a trilha do aluno só avança quando o mês chega.
- **Pacote de aulas:** em vez de mensalidade, o aluno pode pagar por pacote (ex.: 10 aulas). O personal registra cada aula em um toque, o app mostra o saldo, avisa quando o pacote está acabando e conta o valor do pacote no faturamento do dia em que foi pago. Aulas dadas além do pacote ficam devendo, pelo valor de cada aula.
- **Vencimento no autocadastro:** o aluno pode escolher o dia de pagamento no convite; o personal confirma ou ajusta.
- **Pausas:** períodos com início e fim. Em cada pausa o personal escolhe se a mensalidade continua valendo.
- **Lembretes:** o painel abre o WhatsApp do personal com a mensagem pronta para cada aluno. O tom com o aluno é sempre leve.
- **Página do aluno:** trilha de meses, selos, Pix copia e cola e arte para compartilhar. O "Já paguei" do aluno é só um aviso; quem confirma é o personal.
- **IA:** sugere frases para a arte e reescreve o lembrete. O personal sempre aprova antes.
- **App na tela de início:** o painel é um PWA. No celular, o personal vê um aviso para colocar o Renova.AI na tela de início. No Android há um botão de instalar; no iPhone, o passo a passo do Safari. Nada passa pela App Store ou pelo Google Play. O "Agora não" esconde o aviso por 7 dias, e a opção continua na aba Conta.

Não há provedor de pagamento nem envio automático de mensagens: o custo de operação é zero.

## Publicar na Cloudflare (gratuito)

O app roda como um **Worker** conectado a este repositório do GitHub.
O arquivo `wrangler.jsonc` já declara tudo: a pasta `public/`, o banco D1 (`DB`) e a IA (`AI`).
Na publicação, a Cloudflare cria o banco e liga a IA sozinha, e as tabelas são criadas no primeiro acesso.

Cada alteração enviada ao GitHub é publicada automaticamente.

Opcional: a variável `AI_MODEL` troca o modelo de IA (o padrão é `@cf/meta/llama-3.1-8b-instruct`).

## Estrutura

- `public/`: telas (convite, aluno, painel) em HTML, CSS e JavaScript puro, sem etapa de build.
  `manifest.webmanifest`, `sw.js` e `icones/` fazem o painel funcionar como app instalável.
- `src/`: servidor (Cloudflare Workers). A entrada é `src/worker.js` e a API fica em `src/api.js`.
- `lib/`: regras da jornada (meses, selos, sequência), mensalidades, geração do Pix e estrutura do banco.
  As mudanças no banco só acrescentam tabelas e colunas; a conversão dos dados antigos roda uma vez e é coberta por teste.
- `testes/`: testes automáticos e um servidor local com banco em memória.

## Testar no computador

Requer Node.js 22 ou mais novo. Não há dependências para instalar.

```
npm test                        # roda os testes
node testes/servidor-local.js   # abre o app em http://localhost:8788
```

## Recuperação de senha

Não há envio de e-mail. Ao criar a conta, o personal recebe um código de recuperação (mostrado uma vez).
Em "Esqueci minha senha", ele informa e-mail, código e a senha nova. Um novo código pode ser gerado na aba Conta.

Quem perder a senha e o código pede ajuda à administração. Em `/admin`, com a chave de administração,
gera-se um código novo para o e-mail da conta. A chave fica na Cloudflare como segredo `ADMIN_KEY`
(em *Settings > Variables and Secrets*, tipo *Secret*, com 20 caracteres ou mais). Sem esse segredo, a área fica desligada.
