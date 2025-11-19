import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import * as XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function lerXLSX(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
  return data;
}

function lerJSON(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "[]");
    return [];
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function salvarJSON(filePath, produtos) {
  fs.writeFileSync(filePath, JSON.stringify(produtos, null, 2));
}

function limparNome(nome) {
  if (!nome) return "";
  nome = nome.trim();
  const separadores = [" | ", " - ", " – "];
  for (const sep of separadores) {
    if (nome.includes(sep)) {
      nome = nome.split(sep)[0].trim();
    }
  }
  return nome;
}

async function buscarNoCosmosHTML(codigo) {
  try {
    const url = `https://world.openfoodfacts.org/api/v0/product/${codigo}.json`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const data = await response.json();
    
    if (data.status === 1 && data.product) {
      const nome = data.product.product_name || "";
      const marca = data.product.brands || "";
      return marca ? `${nome} - ${marca}` : nome;
    }
    
    return null;
  } catch (error) {
    console.error('Erro ao buscar:', error);
    return null;
  }
}

app.get("/consulta/:codigo", async (req, res) => {
  try {
    const codigo = req.params.codigo;
    const xlsxPath = path.join(__dirname, "data", "PARA_BUSCAR_DO_SITE.xlsx");
    const csvPath = path.join(__dirname, "data", "PARA_BUSCAR_DO_SITE.csv");
    const jsonPath = path.join(__dirname, "data", "produtos.json");

    // 1. BUSCAR NO XLSX (se existir)
    if (fs.existsSync(xlsxPath)) {
      const produtos = lerXLSX(xlsxPath);
      const produto = produtos.find(p => {
        const cod = String(p['Cod de Barra'] || p['codigo'] || p['Código'] || '').trim();
        return cod === codigo;
      });

      if (produto) {
        return res.json({
          ok: true,
          produto: {
            'cod de barra': produto['Cod de Barra'] || codigo,
            'produto': produto['Produto'] || produto['produto'] || produto['nome'],
            'grupo': produto['Grupo'] || produto['grupo'] || '',
            'subgrupo': produto['Subgrupo'] || produto['subgrupo'] || '',
            'marca': produto['Marca'] || produto['marca'] || '',
            'peso bruto': produto['Peso Bruto'] || produto['peso'] || '',
            'preço r$': produto['Preço R$'] || produto['preco'] || ''
          },
          origem: "local"
        });
      }
    }

    // 2. BUSCAR NO CSV (fallback)
    if (fs.existsSync(csvPath)) {
      const csv = fs.readFileSync(csvPath, "utf8");
      const linhas = csv.split('\n').filter(l => l.trim());
      
      if (linhas.length > 1) {
        const headers = linhas[0].split(',').map(h => h.trim().toLowerCase());
        
        for (let i = 1; i < linhas.length; i++) {
          const valores = linhas[i].split(',');
          const cod = valores[0] ? valores[0].trim() : '';
          
          if (cod === codigo) {
            const produto = {};
            headers.forEach((h, idx) => {
              produto[h] = valores[idx] ? valores[idx].trim() : '';
            });
            
            return res.json({
              ok: true,
              produto: produto,
              origem: "local"
            });
          }
        }
      }
    }

    // 3. BUSCAR NA API
    console.log(`Código ${codigo} não encontrado. Buscando online...`);
    
    const nome = await buscarNoCosmosHTML(codigo);

    if (nome) {
      const produtosJSON = lerJSON(jsonPath);
      const existe = produtosJSON.find(p => p.codigo === codigo);
      
      if (!existe) {
        produtosJSON.push({
          codigo: codigo,
          nome: limparNome(nome)
        });
        salvarJSON(jsonPath, produtosJSON);
      }
      
      return res.json({
        ok: true,
        produto: {
          codigo: codigo,
          nome: limparNome(nome)
        },
        origem: "online",
        salvo: !existe
      });
    }

    return res.json({ 
      ok: false, 
      mensagem: "Produto não encontrado" 
    });

  } catch (e) {
    console.error(e);
    return res.json({ 
      ok: false, 
      mensagem: "Erro ao consultar" 
    });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`MISE rodando na porta ${PORT}`);
});