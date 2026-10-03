export const MENU = [
  "1 - Pedir cotação",
  "2 - Ver planos/preços",
  "3 - Pagar licença existente",
  "4 - Encomendar sistema/serviço novo",
  "5 - Falar com administrador",
  "6 - 📅 Agendar Demonstração / Qualificação",
].join("\n");

export function sendMenu(send, nome, isAdmin = false) {
  const saudacao = nome ? `Olá ${nome}!` : "Olá!";
  
  let menuStr = MENU;
  if (isAdmin) {
    menuStr += "\n\n🛠️ *Comandos Privados (Apenas Admin):*\n";
    menuStr += "• *!dashboard* - Relatório IA de Gestão\n";
    menuStr += "• *!responder [número] [msg]* - Chat manual com cliente";
  }

  return send(
    `${saudacao} Sou o assistente da TECNOINCUBADORA. 🙂\n\n` +
      "Escolha uma opção:\n" +
      menuStr +
      '\n\n💡 _Dica: Podes enviar uma *Nota de Voz* ou uma *Fotografia* a qualquer momento e eu consigo entender!_' +
      '\n\n(escreva "0" para voltar ao menu)'
  );
}
