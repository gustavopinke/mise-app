// ------------------------------------------------------------
// MISE - SERVER.JS (VERSÃO ESTÁVEL E FUNCIONAL)
// ------------------------------------------------------------
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import xlsx from "xlsx";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ------------------------------------------------------------
// 🔥 CONFIGURAÇÃO DE ARQUIVOS
// ------------------------------------------------------------
const excelPath = path.join(__dirname, "data", "OK BASE DO APP COLETADO.xlsx");
const jsonPath = path.join(__dirname, "data", "produtos.json");

// ------------------------------------------------------------
// 🔥 LER EXCEL SEM CARREGAR TUDO NA MEMÓRIA
// ------------------------------------------------------------
function buscarNoExcel(codigo) {
  if (!fs.existsSync(excelPath)) return null;

  const workbook = xlsx.readFile(excelPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const linhas = xlsx.utils.sheet_to_json(sheet, { defval: "" });

  for (const linha of linhas) {
    const cod = String(linha["Cod. de Barra"] || "").replace(/\D/g, "");
    if (cod === codigo) {
      return linha["Produto"] || "";
    }
  }

  return null;
}

// ------------------------------------------------------------
// 🔥 SALVAR NO EXCEL SEM DUPLICAR
// ------------------------------------------------------------
function salvarNoExcel(codigo, nome) {
  const workbook = xlsx.readFile(excelPath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const linhas = xlsx.utils.sheet_to_json(sheet, { defval: "" });

  // SE JÁ EXISTE, NÃO ADICIONA
  if (linhas.some(l => String(l["Cod. de Barra"]) === codigo)) return;

  linhas.push({ "Cod. de Barra": codigo, Produto: nome });

  const novoSheet = xlsx.utils.json_to_sheet(linhas);
  workbook.Sheets[sheetName] = novoSheet;

  xlsx.writeFile(workbook, excelPath);
}

// ------------------------------------------------------------
// 🔥 COSMOS (SEM CHAVE) – IGUAL SEU PYTHON
// ------------------------------------------------------------
async function buscarNoCosmos(codigo) {
  try {
    const url = `https://cosmos.bluesoft.com.br/products/${codigo}`;
    const html = await fetch(url).then(r => r.text());

    const titulo = html.match(/<title>(.*?)<\/title>/i);
    if (!titulo) return null;

    let nome = titulo[1].replace("- Cosmos", "").trim();

    if (nome === codigo || nome.length < 3) return null;

    return nome;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// 🔥 OPEN FOOD FACTS (fallback)
// ------------------------------------------------------------
async function buscarNoOpenFoodFacts(codigo) {
  try {
    const url = `https://world.openfoodfacts.org/api/v0/product/${codigo}.json`;
    const resp = await fetch(url).then(r => r.json());

    if (resp.status === 1) {
      return resp.product.product_name || null;
    }
    return null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// 🔥 ROTA DE CONSULTA
// ------------------------------------------------------------
app.get("/consulta/:codigo", async (req, res) => {
  const codigo = req.params.codigo.replace(/\D/g, "");

  if (!codigo) {
    return res.json({ ok: false, mensagem: "Código inválido" });
  }

  console.log("🔍 Buscando:", codigo);

  // 1) Buscar no Excel
  const nomeLocal = buscarNoExcel(codigo);
  if (nomeLocal) {
    return res.json({
      ok: true,
      origem: "local",
      produto: { codigo, nome: nomeLocal }
    });
  }

  // 2) Buscar no Cosmos
  const nomeCosmos = await buscarNoCosmos(codigo);
  if (nomeCosmos) {
    salvarNoExcel(codigo, nomeCosmos); // sem duplicar
    return res.json({
      ok: true,
      origem: "cosmos",
      produto: { codigo, nome: nomeCosmos }
    });
  }

  // 3) OpenFoodFacts
  const nomeOFF = await buscarNoOpenFoodFacts(codigo);
  if (nomeOFF) {
    salvarNoExcel(codigo, nomeOFF);
    return res.json({
      ok: true,
      origem: "openfoodfacts",
      produto: { codigo, nome: nomeOFF }
    });
  }

  // 4) Nada encontrado
  return res.json({ ok: false, mensagem: "Produto não encontrado" });
});

// ------------------------------------------------------------
// 🔥 TELA PRINCIPAL
// ------------------------------------------------------------
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ------------------------------------------------------------
// 🔥 INICIAR SERVIDOR
// ------------------------------------------------------------
app.listen(PORT, () => {
  console.log("🔥 MISE rodando na porta", PORT);
});
