export const MENU = [
  "1 - Pedir cotação",
  "2 - Ver planos/preços",
  "3 - Pagar licença existente",
  "4 - Encomendar sistema/serviço novo",
  "5 - Falar com administrador",
  "6 - 📅 Agendar Demonstração / Qualificação",
  "7 - 🎵 DoReMi (Músicas & Beats à venda)",
].join("\n");

export function sendAdminHelp(send) {
  return send(
    "🛠️ *Instruções do Admin*\n\n" +
      "*!licenca* — actualizar licença paga em cash\n" +
      "1. Escolher o sistema (1 a 4)\n" +
      "2. Escrever o nome do tenant\n" +
      "3. Escolher/confirmar a conta\n" +
      "4. Nova data-fim (AAAA-MM-DD) ou +30/+60/+90/+365\n" +
      "5. Valor pago (0 para omitir)\n" +
      "6. 1 para confirmar e receber o talão\n\n" +
      "*!responder NÚMERO MENSAGEM* — responder a um cliente\n" +
      "*!dashboard* — relatório de gestão\n" +
      "*nhamainga* — abrir o menu especializado da farmácia Nhamainga\n" +
      "*!ajuda* — mostrar estas instruções"
  );
}

export function sendMenu(send, nome, isAdmin = false) {
  const saudacao = nome ? `Olá ${nome}!` : "Olá!";
  
  let menuStr = MENU;
  if (isAdmin) {
    menuStr += "\n\n🛠️ *Comandos Privados (Apenas Admin):*\n";
    menuStr += "• *!dashboard* - Relatório IA de Gestão\n";
    menuStr += "• *!licenca* - Actualizar licença (pagamento cash)\n";
    menuStr += "• *nhamainga* - Menu especializado da farmácia Nhamainga\n";
    menuStr += "• *!responder [número] [msg]* - Chat manual com cliente\n";
    menuStr += "• *!ajuda* - Instruções dos comandos";
  }

  return send(
    `${saudacao} Sou o assistente da TECNOINCUBADORA. 🙂\n\n` +
      "Escolha uma opção:\n" +
      menuStr +
      '\n\n💡 _Dica: Podes enviar uma *Nota de Voz* ou uma *Fotografia* a qualquer momento e eu consigo entender!_' +
      '\n\n(escreva "0" para voltar ao menu)'
  );
}
