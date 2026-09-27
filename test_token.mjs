const token = "EAAPepYGwfAkBSnXGEWQHiVxZAjywunqZCofq0BDFntc9w5YWIs706AMiJr1S9ebKzbuTXLUVgQiJZC7CZBR5aWEuqP3B9czTArhX6IUZCYIUohy6htcWK3BEBtlICQub1DYwVquG1ZAw84yDJZAOa6dvb7WLr1mkf8yPVVLCUf15lDxOa5QrDu9TlRBVJZBF7H7tZCgZAqNqVJkqCBkuYlJUTQhRjcne3CP6nqewebQyZBXZC2fVKi1Fhyzi1kEYWO4yXMm509zRaAldphBtO5Awu5r0";
const phoneNumberId = "1349279428267688"; // got this from check_tenants.mjs
const to = "258847981166"; // admin number

async function testToken() {
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
  console.log("Testing token...");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "text",
      text: { preview_url: false, body: "Teste de token pelo script." },
    }),
  });

  const data = await response.text();
  console.log("Status:", response.status);
  console.log("Response:", data);
}

testToken();
