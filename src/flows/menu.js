export const MENU = [
  "1 - Pedir cotaÃ§Ã£o",
  "2 - Ver planos/preÃ§os",
  "3 - Pagar licenÃ§a existente",
  "4 - Encomendar sistema/serviÃ§o novo",
  "5 - Falar com administrador",
  "6 - ðŸ“… Agendar DemonstraÃ§Ã£o / QualificaÃ§Ã£o",
  "7 - ðŸ’¿ DoReMi (Ãlbuns Ã  venda)",
].join("\n");

export function sendAdminHelp(send) {
  return send(
    "ðŸ› ï¸ *InstruÃ§Ãµes do Admin*\n\n" +
      "*!licenca* â€” actualizar licenÃ§a paga em cash\n" +
      "1. Escolher o sistema (1 a 4)\n" +
      "2. Escrever o nome do tenant\n" +
      "3. Escolher/confirmar a conta\n" +
      "4. Nova data-fim (AAAA-MM-DD) ou +30/+60/+90/+365\n" +
      "5. Valor pago (0 para omitir)\n" +
      "6. 1 para confirmar e receber o talÃ£o\n\n" +
      "*!responder NÃšMERO MENSAGEM* â€” responder a um cliente\n" +
      "*!dashboard* â€” relatÃ³rio de gestÃ£o\n" +
      "*nhamainga* â€” abrir o menu especializado da farmÃ¡cia Nhamainga\n" +
      "*!ajuda* â€” mostrar estas instruÃ§Ãµes"
  );
}

export function sendMenu(send, nome, isAdmin = false) {
  const saudacao = nome ? `OlÃ¡ ${nome}!` : "OlÃ¡!";
  
  let menuStr = MENU;
  if (isAdmin) {
    menuStr += "\n\nðŸ› ï¸ *Comandos Privados (Apenas Admin):*\n";
    menuStr += "â€¢ *!dashboard* - RelatÃ³rio IA de GestÃ£o\n";
    menuStr += "â€¢ *!licenca* - Actualizar licenÃ§a (pagamento cash)\n";
    menuStr += "â€¢ *nhamainga* - Menu especializado da farmÃ¡cia Nhamainga\n";
    menuStr += "â€¢ *!responder [nÃºmero] [msg]* - Chat manual com cliente\n";
    menuStr += "â€¢ *!ajuda* - InstruÃ§Ãµes dos comandos";
  }

  return send(
    `${saudacao} Sou o assistente da TECNOINCUBADORA. ðŸ™‚\n\n` +
      "Escolha uma opÃ§Ã£o:\n" +
      menuStr +
      '\n\nðŸ’¡ _Dica: Podes enviar uma *Nota de Voz* ou uma *Fotografia* a qualquer momento e eu consigo entender!_' +
      '\n\n(escreva "0" para voltar ao menu)'
  );
}

