import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import axios from "axios";
import XLSX from "xlsx";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Raiz do projeto (funciona local e no Render)
const projectRoot = __dirname;

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// Arquivos estáticos (HTML, imagens, etc)
app.use(express.static(path.join(projectRoot, "public")));

// -------------------------------------------
// NORMALIZA CÓDIGO DE BARRAS (7.8913E+12 → 7891300000000)
// -------------------------------------------
function normalizarCodigo(valor) {
  if (!valor) return "";
  const str = String(valor).trim();

  if (str.toLowerCase().includes("e")) {
    const num = Number(str);
    return String(num.toFixed(0));
  }

  return str.replace(/\D/g, "");
}

// -------------------------------------------
// CARREGA BASE LOCAL (CSV ou XLSX)
// -------------------------------------------
function carregarBase() {
  const csvPath = path.join(projectRoot, "data", "PARA_BUSCAR_DO_SITE.csv");
  const xlsxPath = path.join(projectRoot, "data", "PARA_BUSCAR_DO_SITE.xlsx");

  let produtos = [];

  // Prioridade para CSV
  if (fs.existsSync(csvPath)) {
    const conteudo = fs.readFileSync(csvPath, "utf8").split("\n");
    const cabecalhos = conteudo[0].split(",").map(h => h.trim().toLowerCase());

    for (let i = 1; i < conteudo.length; i++) {
      const colunas = conteudo[i].split(",");
      if (!colunas[0]) continue;

      let obj = {};
      cabecalhos.forEach((cab, idx) => {
        obj[cab] = (colunas[idx] || "").trim();
      });
      obj["cod de barra"] = normalizarCodigo(obj["cod de barra"] || obj["codigo de barra"] || obj["gtin"]);
      produtos.push(obj);
    }
    return produtos;
  }

  // Se não tiver CSV, tenta XLSX
  if (fs.existsSync(xlsxPath)) {
    const workbook = XLSX.readFile(xlsxPath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const linhas = XLSX.utils.sheet_to_json(sheet);

    linhas.forEach(l => {
      let p = {};
      for (const key in l) {
        p[key.toString().toLowerCase().trim()] = String(l[key] ?? "").trim();
      }
      p["cod de barra"] = normalizarCodigo(p["cod de barra"] || p["codigo de barra"] || p["gtin"]);
      produtos.push(p);
    });
  }

  return produtos;
}

// -------------------------------------------
// BUSCA ONLINE – COSMOS (Bluesoft)
// -------------------------------------------
async function buscarCosmos(codigo) {
  try {
    const url = `https://api.cosmos.bluesoft.com.br/gtins/${codigo}`;
    const resposta = await axios.get(url, {
      headers: { "X-Cosmos-Token": "" } // coloque sua chave aqui se tiver
    });

    if (resposta.data && resposta.data.description) {
      return resposta.data.description;
    }
  } catch (err) {
    // Silencioso – só retorna null se der erro
  }
  return null;
}

// -------------------------------------------
// SALVA PRODUTOS ENCONTRADOS ONLINE
// -------------------------------------------
function salvarProduto(codigo, nome) {
  const jsonPath = path.join(projectRoot, "data", "produtos.json");
  let lista = [];

  try {
    if (fs.existsSync(jsonPath)) {
      lista = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    }
  } catch (e) {
    lista = [];
  }

  if (!lista.find(x => x.codigo === codigo)) {
    lista.push({ codigo, nome });
    fs.writeFileSync(jsonPath, JSON.stringify(lista, null, 2));
  }
}

// -------------------------------------------
// ROTA PRINCIPAL DE CONSULTA
// -------------------------------------------
app.get("/consulta/:codigo", async (req, res) => {
  const codigo = normalizarCodigo(req.params.codigo);
  if (!codigo || codigo.length < 8) {
    return res.json({ ok: false, mensagem: "Código inválido" });
  }

  console.log("🔍 Buscando código:", codigo);

  // 1ª BASE LOCAL (Excel/CSV)
  const baseLocal = carregarBase();
  const encontradoLocal = baseLocal.find(p => p["cod de barra"] === codigo);

  if (encontradoLocal) {
    return res.json({
      ok: true,
      origem: "local",
      produto: encontradoLocal
    });
  }

  // 2ª produtos.json (cache de buscas online anteriores)
  const jsonPath = path.join(projectRoot, "data", "produtos.json");
  if (fs.existsSync(jsonPath)) {
    const cache = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const noCache = cache.find(p => p.codigo === codigo);
    if (noCache) {
      return res.json({
        ok: true,
        origem: "cosmos",
        produto: noCache
      });
    }
  }

  // 3ª BUSCA ONLINE (Cosmos)
  const nomeOnline = await buscarCosmos(codigo);
  if (nomeOnline) {
    salvarProduto(codigo, nomeOnline);
    return res.json({
      ok: true,
      origem: "cosmos",
      produto: { codigo, nome: nomeOnline }
    });
  }

  // Nada encontrado
  res.json({ ok: false, mensagem: "Produto não encontrado" });
});

// -------------------------------------------
// SPA – sempre entrega o index.html
// -------------------------------------------
app.get("*", (req, res) => {
  res.sendFile(path.join(projectRoot, "public", "index.html"));
});

// -------------------------------------------
// INICIA O SERVIDOR
// -------------------------------------------
app.listen(PORT, () => {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(" MISE Scanner rodando!");
  console.log(` Porta: ${PORT}`);
  console.log(` URL: http://localhost:${PORT}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
});