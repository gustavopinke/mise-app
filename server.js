import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import axios from "axios";
import XLSX from "xlsx";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// -------------------------------------------
// CONVERTE NOTAÇÃO CIENTÍFICA (7.8913E+12 → 7891300000000)
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
// LÊ CSV OU XLSX
// -------------------------------------------
function carregarBase() {
  const csvPath = path.join(__dirname, "../data/PARA_BUSCAR_DO_SITE.csv");
  const xlsxPath = path.join(__dirname, "../data/PARA_BUSCAR_DO_SITE.xlsx");

  let produtos = [];

  if (fs.existsSync(csvPath)) {
    const conteudo = fs.readFileSync(csvPath, "utf8").split("\n");
    const cab = conteudo[0].split(",").map(x => x.trim().toLowerCase());

    for (let i = 1; i < conteudo.length; i++) {
      const linha = conteudo[i].split(",");
      if (!linha[0]) continue;

      let obj = {};
      cab.forEach((c, idx) => obj[c] = linha[idx]?.trim() ?? "");
      obj["cod de barra"] = normalizarCodigo(obj["cod de barra"]);
      produtos.push(obj);
    }
    return produtos;
  }

  if (fs.existsSync(xlsxPath)) {
    const wb = XLSX.readFile(xlsxPath);
    const sh = wb.Sheets[wb.SheetNames[0]];
    const linhas = XLSX.utils.sheet_to_json(sh);

    linhas.forEach(l => {
      let p = {};
      for (const key in l) {
        p[key.toLowerCase()] = String(l[key] ?? "").trim();
      }
      p["cod de barra"] = normalizarCodigo(p["cod de barra"]);
      produtos.push(p);
    });

    return produtos;
  }

  return [];
}

// -------------------------------------------
// BUSCA ONLINE – COSMOS (SEM APARECER NO FRONT)
// -------------------------------------------
async function buscarCosmos(codigo) {
  try {
    const url = `https://api.cosmos.bluesoft.com.br/gtins/${codigo}`;
    const r = await axios.get(url, {
      headers: { "X-Cosmos-Token": "" } // SUA CHAVE AQUI (pode deixar vazio)
    });

    if (!r.data || !r.data.description) return null;
    return r.data.description;
  } catch {
    return null;
  }
}

// -------------------------------------------
// SALVAR RESULTADOS ONLINE EM produtos.json
// -------------------------------------------
function salvarProduto(codigo, nome) {
  const jsonPath = path.join(__dirname, "../data/produtos.json");
  let lista = [];

  if (fs.existsSync(jsonPath)) {
    lista = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  }

  if (!lista.find(x => x.codigo === codigo)) {
    lista.push({ codigo, nome });
    fs.writeFileSync(jsonPath, JSON.stringify(lista, null, 2));
  }
}

// -------------------------------------------
// ENDPOINT PRINCIPAL
// -------------------------------------------
app.get("/consulta/:codigo", async (req, res) => {
  const codigo = normalizarCodigo(req.params.codigo);
  if (!codigo) return res.json({ ok: false, mensagem: "Código inválido" });

  console.log("🔍 Consultando:", codigo);

  // 1 — BUSCA NA BASE LOCAL
  const base = carregarBase();
  const local = base.find(p => p["cod de barra"] === codigo);

  if (local) {
    return res.json({
      ok: true,
      origem: "local",
      produto: local
    });
  }

  // 2 — BUSCA NO JSON SALVO
  const jsonPath = path.join(__dirname, "../data/produtos.json");
  if (fs.existsSync(jsonPath)) {
    const list = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const salvo = list.find(p => p.codigo === codigo);
    if (salvo) {
      return res.json({
        ok: true,
        origem: "online-salvo",
        produto: salvo
      });
    }
  }

  // 3 — BUSCA ONLINE (COSMOS)
  const nomeOnline = await buscarCosmos(codigo);

  if (nomeOnline) {
    salvarProduto(codigo, nomeOnline);
    return res.json({
      ok: true,
      origem: "online",
      produto: { codigo, nome: nomeOnline }
    });
  }

  return res.json({ ok: false, mensagem: "Produto não encontrado" });
});

// -------------------------------------------
// SPA
// -------------------------------------------
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

app.listen(PORT, () => {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🚀 MISE Rodando Porta:", PORT);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
});
