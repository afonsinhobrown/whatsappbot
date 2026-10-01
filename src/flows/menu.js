export const MENU = [
  "1 - Pedir cotação",
  "2 - Ver planos/preços",
  "3 - Pagar licença existente",
  "4 - Encomendar sistema/serviço novo",
  "5 - Falar com administrador",
].join("\n");

export function sendMenu(send, nome) {
  const saudacao = nome ? `Olá ${nome}!` : "Olá!";
  return send(
    `${saudacao} Sou o assistente da TECNOINCUBADORA. 🙂\n\n` +
      "Escolha uma opção:\n" +
      MENU +
      '\n\n(escreva "0" para voltar ao menu)'
  );
}
