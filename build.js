/**
 * Build Script para MISE Scanner
 * Verifica e prepara o banco SQLite para deploy
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, 'data', 'produtos.db');
const CSV_PATH = path.join(__dirname, 'data', 'PARA_BUSCAR_DO_SITE.csv');
const XLSX_PATH = path.join(__dirname, 'data', 'PARA_BUSCAR_DO_SITE.xlsx');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  MISE Scanner - Build');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// Verificar se o diretório data existe
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  console.log('📁 Criando diretório data...');
  fs.mkdirSync(dataDir, { recursive: true });
}

// Verificar se o banco SQLite existe e é válido
let precisaMigrar = false;

if (!fs.existsSync(DB_PATH)) {
  console.log('⚠️  Banco SQLite não encontrado');
  precisaMigrar = true;
} else {
  // Verificar se o arquivo é válido (não está corrompido)
  const stats = fs.statSync(DB_PATH);
  if (stats.size < 1000) {
    console.log('⚠️  Banco SQLite parece corrompido (muito pequeno)');
    precisaMigrar = true;
  } else {
    console.log(`✅ Banco SQLite encontrado (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
  }
}

// Se precisa migrar, verificar se temos os arquivos fonte
if (precisaMigrar) {
  if (fs.existsSync(CSV_PATH) || fs.existsSync(XLSX_PATH)) {
    console.log('📦 Executando migração CSV → SQLite...');
    try {
      execSync('node migrate-to-sqlite.js', { stdio: 'inherit', cwd: __dirname });
      console.log('✅ Migração concluída!');
    } catch (err) {
      console.error('❌ Erro na migração:', err.message);
      // Não falhar o build, o app funciona com CSV como fallback
      console.log('⚠️  Continuando com fallback para CSV...');
    }
  } else {
    console.log('⚠️  Arquivos fonte (CSV/XLSX) não encontrados');
    console.log('   O app vai usar fallback para CSV se disponível');
  }
}

// Verificar diretório de fotos
const fotosDir = path.join(__dirname, 'data', 'fotos_produtos');
if (!fs.existsSync(fotosDir)) {
  console.log('📁 Criando diretório de fotos...');
  fs.mkdirSync(fotosDir, { recursive: true });
}

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  Build concluído!');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
