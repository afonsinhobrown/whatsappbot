import { env } from "../config/env.js";
import { setSession } from "../services/sessionService.js";
import { sendDocumentMessage } from "../services/metaApi.js";
import { isSaudacao, responderSaudacaoEmFluxo } from "./saudacao.js";
import {
  getMinhaFarmacia,
  getReport,
  getCaixaHistorico,
  getEstoque,
  getCotacoes,
  criarCotacao,
  getCotacaoPdf,
  enviarCotacaoEmail,
  emitirAviso,
  getAvisoPdf,
  enviarAvisoEmail,
  getVendasPdf,
  getBiPdf,
  getFinanceiroPdf,
} from "../services/gestorfarmaApi.js";

const MENU =
  "🏥 *Nhamainga — Menu Especial*\n\n" +
  "1. Dados da farmácia\n" +
  "2. Saldo do dia\n" +
  "3. Saldo do mês\n" +
  "4. Saldo de um período\n" +
  "5. Estoque\n" +
  "6. Criar cotação\n" +
  "7. Emitir aviso de pagamento\n" +
  "8. Relatórios\n" +
  "0. Sair";

function fmtMZN(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return (
    n.toLocaleString("pt-MZ", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " MZN"
  );
}

function isoLocal(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function hoje() {
  return isoLocal(new Date());
}

function somarDias(dataISO, dias) {
  const d = new Date(`${dataISO}T00:00:00`);
  d.setDate(d.getDate() + dias);
  return isoLocal(d);
}

function dataValida(valor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(valor || ""))) return false;
  const d = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor;
}

function primeiraDoMes() {
  const d = new Date();
  return isoLocal(new Date(d.getFullYear(), d.getMonth(), 1));
}

function soDigitos(v) {
  return String(v || "").replace(/\D/g, "");
}

function normalizarTelefone(v) {
  let d = soDigitos(v);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 9) d = `258${d}`;
  return d;
}

export function isNhamaingaNumber(phone) {
  return Boolean(env.nhamaingaNumber) && soDigitos(phone) === env.nhamaingaNumber;
}

function saudacaoPorTexto(text) {
  const t = String(text || "").toLowerCase();
  if (t.includes("bom dia")) return "Bom dia";
  if (t.includes("boa tarde")) return "Boa tarde";
  if (t.includes("boa noite")) return "Boa noite";
  if (t.includes("boa madrugada")) return "Boa madrugada";
  return "Olá";
}

function conversaSimples(text) {
  const t = String(text || "").toLowerCase();

  if (/\b(obrigad[oa]|agradecid[oa]|valeu)\b/.test(t)) {
    return "De nada! 😊 Se precisar de mais alguma coisa, escreva *menu*.";
  }
  if (/\b(tchau|adeus|at[eé]\s+(logo|breve|mais))\b/.test(t)) {
    return "Até breve! 👋 A Nhamainga fica por aqui quando precisar.";
  }
  if (/\b(quem\s+[eé]s|o\s+que\s+fazes|o\s+que\s+voc[eê]\s+faz|para\s+que\s+serves)\b/.test(t)) {
    return (
      "Sou o assistente da *Nhamainga*. Posso mostrar os dados da farmácia, " +
      "saldos, estoque, cotações, avisos de pagamento e relatórios."
    );
  }
  return null;
}

function acolhimento(client, text) {
  const nome = client && client.nome ? `, ${client.nome}` : "";
  const saudacao = saudacaoPorTexto(text);
  return `${saudacao}${nome}! 👋\n\nSou o assistente da *Nhamainga*. Em que posso ajudar?\n\n`;
}

export function startNhamaingaMenu(send, client = null, text = "") {
  if (isSaudacao(text)) return send(acolhimento(client, text) + MENU);
  return send(MENU);
}

async function voltarMenu(client, send, texto = "") {
  await setSession(client.id, "nhamainga_menu", {});
  return send((texto ? texto + "\n\n" : "") + MENU);
}

function extrairFluxo(report) {
  const f = (report && (report.fluxo_caixa || report.fluxoCaixa)) || {};
  const receita = Number(f.total_receita ?? f.receita ?? 0);
  const despesa = Number(f.total_despesa ?? f.despesa ?? 0);
  const lucro = Number(
    f.lucro_liquido ?? f.lucro ?? (receita - despesa)
  );
  const iva = Number(f.total_iva ?? f.iva ?? 0);
  return { receita, despesa, lucro, iva };
}

async function resumoSaldo(inicio, fim, titulo) {
  const [report, caixa] = await Promise.allSettled([
    getReport(inicio, fim),
    getCaixaHistorico(inicio, fim),
  ]);

  let texto = `💰 *${titulo}*\n📅 ${inicio} a ${fim}\n\n`;

  if (report.status === "fulfilled") {
    const f = extrairFluxo(report.value);
    texto +=
      `Receita: *${fmtMZN(f.receita)}*\n` +
      `Despesas: *${fmtMZN(f.despesa)}*\n` +
      `Lucro: *${fmtMZN(f.lucro)}*\n` +
      `IVA: ${fmtMZN(f.iva)}\n`;
  } else {
    texto += `⚠️ Não consegui ler o resultado: ${report.reason.message}\n`;
  }

  if (caixa.status === "fulfilled") {
    const r = caixa.value && caixa.value.resumo;
    const total = r && (r.total_sistema ?? r.totalSistema);
    if (total !== undefined) texto += `Caixa/gaveta: *${fmtMZN(total)}*\n`;
  }

  return texto;
}

async function dadosFarmacia() {
  const f = await getMinhaFarmacia();
  const linhas = [
    `🏥 *${f.nome_fantasia || f.nome || "Nhamainga"}*`,
    f.nome ? `Nome: ${f.nome}` : null,
    f.nuit ? `NUIT: ${f.nuit}` : null,
    f.email ? `Email: ${f.email}` : null,
    f.telefone_principal ? `Telefone: ${f.telefone_principal}` : null,
    f.endereco ? `Endereço: ${f.endereco}` : null,
    f.cidade || f.provincia
      ? `Local: ${[f.cidade, f.provincia].filter(Boolean).join(", ")}`
      : null,
    f.is_ativa !== undefined
      ? `Estado: ${f.is_ativa ? "activa" : "inactiva"}`
      : null,
  ].filter(Boolean);
  return linhas.join("\n");
}

function precoDaLinha(l) {
  const promo = Number(l.preco_promocional);
  if (l.em_promocao && Number.isFinite(promo) && promo > 0) return promo;
  const venda = Number(l.preco_venda);
  if (Number.isFinite(venda) && venda > 0) return venda;
  const avulso = Number(l.preco_venda_avulso);
  return Number.isFinite(avulso) ? avulso : 0;
}

async function resumoEstoque() {
  const linhas = await getEstoque();
  const lista = Array.isArray(linhas) ? linhas : linhas.results || [];
  const agora = new Date();

  let unidades = 0;
  let valor = 0;
  let baixo = 0;
  let ruptura = 0;
  let expirados = 0;
  let aExpirar = 0;
  const criticos = [];

  for (const l of lista) {
    const qtd = Number(l.quantidade) || 0;
    const custo = Number(l.preco_custo) || 0;
    unidades += qtd;
    valor += qtd * custo;

    if (qtd === 0) ruptura++;
    else if (Number(l.quantidade_minima) > 0 && qtd <= Number(l.quantidade_minima)) {
      baixo++;
      criticos.push({ nome: l.produto_nome, qtd, min: l.quantidade_minima });
    }

    if (l.data_validade) {
      const validade = new Date(l.data_validade);
      const dias = Math.ceil((validade - agora) / 86400000);
      if (dias < 0) expirados++;
      else if (dias <= 30) aExpirar++;
    }
  }

  criticos.sort((a, b) => a.qtd - b.qtd);
  const top = criticos
    .slice(0, 10)
    .map((c) => `• ${c.nome}: ${c.qtd} (mín. ${c.min})`)
    .join("\n");

  return (
    "📦 *Estoque da Nhamainga*\n\n" +
    `Lotes: *${lista.length}*\n` +
    `Unidades: *${unidades}*\n` +
    `Valor a custo: *${fmtMZN(valor)}*\n` +
    `Stock baixo: *${baixo}*\n` +
    `Ruptura: *${ruptura}*\n` +
    `A expirar (30 dias): *${aExpirar}*\n` +
    `Expirados: *${expirados}*\n` +
    (top ? `\n*Mais críticos:*\n${top}` : "")
  );
}

async function enviarPdf(client, tenant, buffer, filename, caption) {
  await sendDocumentMessage(
    client.whatsapp_number,
    { buffer, filename, caption },
    tenant
  );
}

async function enviarPdfAoCliente(client, tenant, buffer, filename, caption, telefone) {
  const destinos = [];
  const tel = normalizarTelefone(telefone);
  if (tel) destinos.push(tel);
  destinos.push(client.whatsapp_number);

  let ultimoErro = null;
  for (const destino of [...new Set(destinos)]) {
    try {
      await sendDocumentMessage(destino, { buffer, filename, caption }, tenant);
      return { ok: true, destino };
    } catch (err) {
      ultimoErro = err.message;
    }
  }
  return { ok: false, erro: ultimoErro };
}

function parseContacto(texto) {
  let telefone = null;
  let email = null;
  for (const parte of String(texto).split(/[\s,;]+/)) {
    if (!parte) continue;
    if (parte.includes("@")) email = parte;
    else if (/\d{6,}/.test(parte)) telefone = parte;
  }
  return { telefone, email };
}

async function menuOpcao(client, text, send, tenant) {
  const conversa = conversaSimples(text);
  if (conversa) return send(conversa);

  if (isSaudacao(text)) {
    return send(acolhimento(client, text) + MENU);
  }

  const opcao = text.trim();
  switch (opcao) {
    case "1": {
      const dados = await dadosFarmacia();
      return voltarMenu(client, send, dados);
    }
    case "2": {
      const d = hoje();
      const resumo = await resumoSaldo(d, d, "Saldo do dia");
      return voltarMenu(client, send, resumo);
    }
    case "3": {
      const resumo = await resumoSaldo(primeiraDoMes(), hoje(), "Saldo do mês");
      return voltarMenu(client, send, resumo);
    }
    case "4":
      await setSession(client.id, "nhamainga_periodo_inicio", {});
      return send("📅 Data de *início* do período (AAAA-MM-DD), ou 0 para voltar.");
    case "5": {
      const resumo = await resumoEstoque();
      return voltarMenu(client, send, resumo);
    }
    case "6":
      await setSession(client.id, "nhamainga_cot_nome", { itens: [] });
      return send(
        "🧾 *Nova cotação*\n\nNome do cliente (ou empresa):\n\nEscreva 0 para voltar."
      );
    case "7":
      return iniciarAviso(client, send);
    case "8":
      await setSession(client.id, "nhamainga_relatorios", {});
      return send(
        "📊 *Relatórios*\n\n1. Vendas (PDF)\n2. BI (PDF)\n3. Financeiro (PDF)\n0. Voltar"
      );
    default:
      return send("Não entendi. Escolha uma opção do menu:\n\n" + MENU);
  }
}

async function iniciarAviso(client, send) {
  const res = await getCotacoes("ACEITE");
  const lista = (Array.isArray(res) ? res : res.results || []).slice(0, 10);
  if (!lista.length) {
    return voltarMenu(
      client,
      send,
      "Não há cotações com estado *ACEITE* para emitir aviso."
    );
  }

  const texto = lista
    .map(
      (c, i) =>
        `${i + 1}. ${c.numero || `#${c.id}`} — ${c.cliente_nome || "cliente"} — ${fmtMZN(
          c.total
        )}`
    )
    .join("\n");

  await setSession(client.id, "nhamainga_aviso_lista", { cotacoes: lista });
  return send(
    `📄 *Cotações aceites*\n\n${texto}\n\nEscolha o número da cotação, ou 0 para voltar.`
  );
}

async function handleCotProduto(client, ctx, text, send) {
  const busca = text.trim();
  if (busca.length < 2) return send("Escreva pelo menos 2 letras do produto.");

  const res = await getEstoque(busca);
  const lista = (Array.isArray(res) ? res : res.results || [])
    .filter((l) => Number(l.is_disponivel) !== 0)
    .slice(0, 8);

  if (!lista.length) {
    return send("Não encontrei esse produto no stock. Escreva outro nome/código.");
  }

  const texto = lista
    .map(
      (l, i) =>
        `${i + 1}. ${l.produto_nome}${l.lote ? ` (lote ${l.lote})` : ""} — ` +
        `${fmtMZN(precoDaLinha(l))} — stock ${l.quantidade}`
    )
    .join("\n");

  await setSession(client.id, "nhamainga_cot_escolha", {
    ...ctx,
    produtos: lista,
  });
  return send(`Produtos encontrados:\n\n${texto}\n\nEscolha o número, ou 0 para voltar.`);
}

async function finalizarCotacao(client, ctx, text, send, tenant) {
  const opcao = text.trim();
  if (!["1", "2", "3"].includes(opcao)) {
    return send("Responda 1 (WhatsApp), 2 (email) ou 3 (ambos).");
  }

  const tel = ctx.telefone ? soDigitos(ctx.telefone) : "";
  const email = ctx.email || "";
  const payload = {
    cliente_nome: ctx.clienteNome,
    cliente_telefone: tel,
    cliente_email: email,
    data_emissao: hoje(),
    data_validade: somarDias(hoje(), 30),
    descricao: "Cotação criada via WhatsApp",
    itens: ctx.itens.map((i) => ({
      ...(i.produto ? { produto: i.produto } : {}),
      descricao: i.descricao,
      unidade: "Unidade",
      quantidade: i.quantidade,
      preco_unitario: i.preco,
    })),
  };

  let cot;
  try {
    cot = await criarCotacao(payload);
  } catch (err) {
    return voltarMenu(client, send, `❌ Não consegui criar a cotação: ${err.message}`);
  }

  const linhas = [];
  const querWhats = opcao === "1" || opcao === "3";
  const querEmail = opcao === "2" || opcao === "3";

  if (querWhats) {
    try {
      const pdf = await getCotacaoPdf(cot.id);
      const envio = await enviarPdfAoCliente(
        client,
        tenant,
        pdf,
        `${cot.numero || "cotacao"}.pdf`,
        `Cotação ${cot.numero || ""} — ${ctx.clienteNome}`,
        ctx.telefone
      );
      linhas.push(
        envio.ok
          ? `✅ WhatsApp: enviado para ${envio.destino}`
          : `⚠️ WhatsApp falhou: ${envio.erro}`
      );
    } catch (err) {
      linhas.push(`⚠️ WhatsApp falhou: ${err.message}`);
    }
  }

  if (querEmail) {
    if (!email) {
      linhas.push("⚠️ Email: o cliente não tem email indicado.");
    } else {
      try {
        await enviarCotacaoEmail(cot.id, { email });
        linhas.push(`✅ Email: enviado para ${email}`);
      } catch (err) {
        linhas.push(`⚠️ Email falhou: ${err.message}`);
      }
    }
  }

  return voltarMenu(
    client,
    send,
    `🧾 *Cotação ${cot.numero || `#${cot.id}`} criada*\n` +
      `Cliente: ${ctx.clienteNome}\n` +
      `Total: *${fmtMZN(cot.total)}*\n\n` +
      linhas.join("\n")
  );
}

async function handleAvisoEnvio(client, ctx, text, send, tenant) {
  const opcao = text.trim();
  if (!["1", "2", "3"].includes(opcao)) {
    return send("Responda 1 (WhatsApp), 2 (email) ou 3 (ambos).");
  }

  const aviso = ctx.aviso;
  const cotacao = ctx.cotacao || {};
  const linhas = [];

  if (opcao === "1" || opcao === "3") {
    try {
      const pdf = await getAvisoPdf(aviso.id);
      const envio = await enviarPdfAoCliente(
        client,
        tenant,
        pdf,
        `${aviso.numero || "aviso"}.pdf`,
        `Aviso de pagamento ${aviso.numero || ""}`,
        cotacao.cliente_telefone
      );
      linhas.push(
        envio.ok
          ? `✅ WhatsApp: enviado para ${envio.destino}`
          : `⚠️ WhatsApp falhou: ${envio.erro}`
      );
    } catch (err) {
      linhas.push(`⚠️ WhatsApp falhou: ${err.message}`);
    }
  }

  if (opcao === "2" || opcao === "3") {
    const email = cotacao.cliente_email;
    if (!email) {
      linhas.push("⚠️ Email: a cotação não tem email do cliente.");
    } else {
      try {
        await enviarAvisoEmail(aviso.id, { email });
        linhas.push(`✅ Email: enviado para ${email}`);
      } catch (err) {
        linhas.push(`⚠️ Email falhou: ${err.message}`);
      }
    }
  }

  return voltarMenu(
    client,
    send,
    `📄 *Aviso ${aviso.numero || `#${aviso.id}`} emitido*\n` +
      `Saldo: *${fmtMZN(aviso.saldo ?? aviso.valor_total)}*\n\n` +
      linhas.join("\n")
  );
}

/**
 * Dispatcher dos estados do menu Nhamainga. É usado pelo número especializado
 * e pelo admin depois de enviar o comando `nhamainga`.
 */
export async function handleNhamaingaState(estado, client, ctx, text, send, tenant) {
  const lower = text.trim().toLowerCase();

  if (["menu", "voltar", "sair", "cancelar"].includes(lower)) {
    return voltarMenu(client, send);
  }
  if (lower === "0" && estado !== "nhamainga_cot_mais") {
    return voltarMenu(client, send);
  }

  const conversa = conversaSimples(text);
  if (conversa) return send(conversa);

  // A meio de um preenchimento, uma saudação não pode deitar fora o que já
  // foi respondido; acolhe-se e continua-se no mesmo estado.
  if (estado !== "nhamainga_menu" && isSaudacao(text)) {
    return responderSaudacaoEmFluxo(client, send);
  }

  try {
    switch (estado) {
      case "nhamainga_menu":
        return await menuOpcao(client, text, send, tenant);

      case "nhamainga_periodo_inicio": {
        if (!dataValida(text.trim())) {
          return send("Data inválida. Use AAAA-MM-DD.");
        }
        await setSession(client.id, "nhamainga_periodo_fim", {
          inicio: text.trim(),
        });
        return send("📅 Data de *fim* do período (AAAA-MM-DD).");
      }

      case "nhamainga_periodo_fim": {
        if (!dataValida(text.trim())) {
          return send("Data inválida. Use AAAA-MM-DD.");
        }
        const fim = text.trim();
        if (fim < ctx.inicio) return send("A data de fim não pode ser anterior ao início.");
        const resumo = await resumoSaldo(
          ctx.inicio,
          fim,
          "Saldo do período"
        );
        return voltarMenu(client, send, resumo);
      }

      case "nhamainga_relatorios": {
        const op = text.trim();
        if (op === "1") {
          await setSession(client.id, "nhamainga_rel_vendas_inicio", {});
          return send("📅 Início do relatório de vendas (AAAA-MM-DD).");
        }
        if (op === "2") {
          await setSession(client.id, "nhamainga_rel_bi_meses", {});
          return send("Quantos meses para o relatório BI? (ex.: 6)");
        }
        if (op === "3") {
          const pdf = await getFinanceiroPdf();
          await enviarPdf(
            client,
            tenant,
            pdf,
            "relatorio-financeiro.pdf",
            "Relatório financeiro — Nhamainga"
          );
          return voltarMenu(client, send, "✅ Relatório financeiro enviado.");
        }
        return send("Escolha 1, 2, 3 ou 0.");
      }

      case "nhamainga_rel_vendas_inicio": {
        if (!dataValida(text.trim())) return send("Data inválida. Use AAAA-MM-DD.");
        await setSession(client.id, "nhamainga_rel_vendas_fim", {
          inicio: text.trim(),
        });
        return send("📅 Fim do relatório de vendas (AAAA-MM-DD).");
      }

      case "nhamainga_rel_vendas_fim": {
        if (!dataValida(text.trim())) return send("Data inválida. Use AAAA-MM-DD.");
        const fim = text.trim();
        if (fim < ctx.inicio) return send("A data de fim não pode ser anterior ao início.");
        const pdf = await getVendasPdf(ctx.inicio, fim);
        await enviarPdf(
          client,
          tenant,
          pdf,
          `vendas-${ctx.inicio}-${fim}.pdf`,
          `Relatório de vendas ${ctx.inicio} a ${fim}`
        );
        return voltarMenu(client, send, "✅ Relatório de vendas enviado.");
      }

      case "nhamainga_rel_bi_meses": {
        const meses = parseInt(text.trim(), 10);
        if (!meses || meses < 1 || meses > 24) {
          return send("Indique um número de meses entre 1 e 24.");
        }
        const pdf = await getBiPdf(meses);
        await enviarPdf(
          client,
          tenant,
          pdf,
          `relatorio-bi-${meses}m.pdf`,
          `Relatório BI — últimos ${meses} meses`
        );
        return voltarMenu(client, send, "✅ Relatório BI enviado.");
      }

      /* --- Cotação --- */
      case "nhamainga_cot_nome": {
        const nome = text.trim();
        if (nome.length < 2) return send("Escreva o nome do cliente.");
        await setSession(client.id, "nhamainga_cot_contacto", {
          ...ctx,
          clienteNome: nome,
        });
        return send(
          "Contacto do cliente: telefone e/ou email (ex.: 84xxxxxxx ou cliente@email.com).\n" +
            'Escreva "0" para voltar.'
        );
      }

      case "nhamainga_cot_contacto": {
        const { telefone, email } = parseContacto(text);
        if (!telefone && !email) {
          return send("Indique um telefone ou um email válido.");
        }
        await setSession(client.id, "nhamainga_cot_produto", {
          ...ctx,
          telefone,
          email,
        });
        return send(
          "Produto a cotar: escreva o nome ou código de barras.\n\nEscreva 0 para voltar."
        );
      }

      case "nhamainga_cot_produto":
        return await handleCotProduto(client, ctx, text, send);

      case "nhamainga_cot_escolha": {
        const n = parseInt(text.trim(), 10);
        const produto = (ctx.produtos || [])[n - 1];
        if (!produto) return send("Escolha um número da lista, ou 0 para voltar.");
        await setSession(client.id, "nhamainga_cot_qtd", {
          ...ctx,
          produtoSel: produto,
        });
        return send(
          `Produto: *${produto.produto_nome}*\n` +
            `Preço: *${fmtMZN(precoDaLinha(produto))}*\n\nQuantidade?`
        );
      }

      case "nhamainga_cot_qtd": {
        const qtd = Number(String(text).replace(",", "."));
        if (!Number.isFinite(qtd) || qtd <= 0) {
          return send("Indique uma quantidade válida.");
        }
        const p = ctx.produtoSel;
        const itens = [
          ...(ctx.itens || []),
          {
            produto: p.produto,
            descricao: p.produto_nome,
            quantidade: qtd,
            preco: precoDaLinha(p),
          },
        ];
        await setSession(client.id, "nhamainga_cot_mais", { ...ctx, itens });
        return send(
          `Adicionado: *${p.produto_nome}* × ${qtd}\n\n` +
            "1. Adicionar outro produto\n0. Finalizar cotação"
        );
      }

      case "nhamainga_cot_mais": {
        if (text.trim() === "1") {
          await setSession(client.id, "nhamainga_cot_produto", ctx);
          return send("Escreva o nome/código do próximo produto.");
        }
        if (text.trim() !== "0") {
          return send("Responda 1 para adicionar outro, ou 0 para finalizar.");
        }
        if (!ctx.itens || !ctx.itens.length) {
          return send("Não há itens na cotação. Adicione pelo menos um.");
        }
        await setSession(client.id, "nhamainga_cot_envio", ctx);
        return send(
          "Como quer enviar a cotação?\n\n1. WhatsApp (PDF)\n2. Email (PDF)\n3. Ambos"
        );
      }

      case "nhamainga_cot_envio":
        return await finalizarCotacao(client, ctx, text, send, tenant);

      /* --- Aviso de pagamento --- */
      case "nhamainga_aviso_lista": {
        const n = parseInt(text.trim(), 10);
        const cotacao = (ctx.cotacoes || [])[n - 1];
        if (!cotacao) return send("Escolha um número da lista, ou 0 para voltar.");
        await setSession(client.id, "nhamainga_aviso_venc", { ...ctx, cotacao });
        return send(
          `Cotação *${cotacao.numero || `#${cotacao.id}`}* — ${cotacao.cliente_nome}\n\n` +
            "Data de vencimento do aviso (AAAA-MM-DD).\n" +
            `Sugestão: ${somarDias(hoje(), 30)}`
        );
      }

      case "nhamainga_aviso_venc": {
        if (!dataValida(text.trim())) return send("Data inválida. Use AAAA-MM-DD.");
        const aviso = await emitirAviso(ctx.cotacao.id, {
          data_vencimento: text.trim(),
        });
        await setSession(client.id, "nhamainga_aviso_envio", {
          ...ctx,
          aviso,
        });
        return send(
          `📄 Aviso *${aviso.numero || `#${aviso.id}`}* emitido.\n` +
            `Saldo: *${fmtMZN(aviso.saldo ?? aviso.valor_total)}*\n\n` +
            "Como quer enviar?\n\n1. WhatsApp (PDF)\n2. Email (PDF)\n3. Ambos"
        );
      }

      case "nhamainga_aviso_envio":
        return await handleAvisoEnvio(client, ctx, text, send, tenant);

      default:
        return voltarMenu(client, send);
    }
  } catch (err) {
    console.error("[NHAMAINGA] erro:", err.message);
    return voltarMenu(client, send, `❌ ${err.message}`);
  }
}
