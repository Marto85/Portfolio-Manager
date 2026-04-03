# Portfolio AR — Guía Completa

---

## 1. Estructura de archivos

```
portfolio-ar/
│
├── init_db.sql                        ← Schema de la base de datos
│
├── backend/
│   ├── main.py                        ← API FastAPI (toda la lógica)
│   ├── requirements.txt               ← Dependencias Python
│   ├── .env.example                   ← Plantilla de variables de entorno
│   └── .env                           ← Tu config local (NO subir a GitHub)
│
└── frontend/
    ├── index.html
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── .env.example
    ├── .env                           ← Tu config local (NO subir a GitHub)
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── index.css
        ├── utils/
        │   └── api.js
        └── components/
            ├── AuthPage.jsx
            ├── Dashboard.jsx
            └── AddTransaction.jsx
```

---

## 2. Requisitos previos (instalar una sola vez)

| Herramienta | Instalación |
|-------------|-------------|
| **Python 3.11+** | https://python.org |
| **Node.js 18+** | https://nodejs.org |
| **PostgreSQL 15+** | https://www.postgresql.org/download/ |
| **Git** | https://git-scm.com |

> En Mac podés instalar PostgreSQL con `brew install postgresql@15`
> En Windows descargá el instalador de postgresql.org (incluye psql)

---

## 3. Correr localmente paso a paso

### 3.1 — Base de datos

```bash
# Abrir la consola de PostgreSQL
psql -U postgres

# Dentro de psql, crear la base de datos
CREATE DATABASE portfolio_ar;
\q

# Ejecutar el schema (desde la carpeta raíz portfolio-ar/)
psql -U postgres -d portfolio_ar -f init_db.sql

# Verificar que las tablas existen
psql -U postgres -d portfolio_ar -c "\dt"
# Debería listar: users, portfolios, transactions
# y las views: v_positions, v_portfolio_summary
```

### 3.2 — Backend

```bash
# Pararse en la carpeta backend
cd portfolio-ar/backend

# Crear entorno virtual (recomendado)
python -m venv venv

# Activar el entorno virtual
# En Mac/Linux:
source venv/bin/activate
# En Windows:
venv\Scripts\activate

# Instalar dependencias
pip install -r requirements.txt

# Configurar variables de entorno
cp .env.example .env
# Abrir .env con tu editor y completar:
#   DATABASE_URL=postgresql://postgres:TU_CONTRASEÑA@localhost:5432/portfolio_ar
#   SECRET_KEY=cualquier-cadena-larga-y-aleatoria

# Levantar el servidor
uvicorn main:app --reload --port 8000

# ✅ Backend corriendo en http://localhost:8000
# ✅ Documentación automática en http://localhost:8000/docs
```

### 3.3 — Frontend

```bash
# En otra terminal, pararse en la carpeta frontend
cd portfolio-ar/frontend

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# El .env del frontend puede quedar con los valores por defecto
# VITE_API_URL=http://localhost:8000

# Levantar el servidor de desarrollo
npm run dev

# ✅ Frontend corriendo en http://localhost:5173
```

### 3.4 — Verificar que todo funciona

1. Abrir http://localhost:5173
2. Registrar un usuario nuevo
3. Crear un portfolio
4. Agregar una compra (ej: GGAL, tipo ACCION, precio en ARS)
5. Ver la posición con precio actualizado

---

## 4. Subir a GitHub

### 4.1 — Crear el .gitignore primero

Crear el archivo `portfolio-ar/.gitignore`:

```
# Python
venv/
__pycache__/
*.pyc
.env

# Node
node_modules/
dist/
.env
.env.local

# OS
.DS_Store
Thumbs.db
```

### 4.2 — Inicializar el repositorio

```bash
# Pararse en la raíz del proyecto
cd portfolio-ar

# Inicializar git
git init

# Agregar todos los archivos (el .gitignore excluye lo sensible)
git add .

# Primer commit
git commit -m "feat: initial Portfolio AR setup"
```

### 4.3 — Crear el repositorio en GitHub

1. Ir a https://github.com/new
2. Nombre: `portfolio-ar` (o el que prefieras)
3. Seleccionar **Private** (recomendado, tiene datos financieros)
4. **NO** tildar "Initialize with README" (ya tenemos archivos)
5. Click "Create repository"

### 4.4 — Conectar y subir

```bash
# Reemplazar TU_USUARIO con tu usuario de GitHub
git remote add origin https://github.com/TU_USUARIO/portfolio-ar.git
git branch -M main
git push -u origin main
```

### 4.5 — Verificar que .env NO se subió

En GitHub, revisar que no aparezcan los archivos `.env` (solo `.env.example`).

---

## 5. Deploy en producción

### Plataformas elegidas
- **Base de datos**: Render (PostgreSQL managed, tier gratuito)
- **Backend**: Render (Web Service Python, tier gratuito)
- **Frontend**: Vercel (Static Site, tier gratuito, el más simple)

---

### 5.1 — Deploy de la base de datos en Render

1. Ir a https://render.com → Sign up / Login
2. Click **"New +"** → **"PostgreSQL"**
3. Configurar:
   - **Name**: `portfolio-ar-db`
   - **Database**: `portfolio_ar`
   - **User**: (dejar el que genera Render)
   - **Region**: Ohio o la más cercana
   - **Plan**: Free
4. Click **"Create Database"**
5. Esperar ~2 minutos
6. En la página del DB, copiar el valor de **"External Database URL"**
   - Tiene este formato: `postgresql://usuario:contraseña@host.render.com/portfolio_ar`
7. **Ejecutar el schema** (desde tu máquina local, una sola vez):
   ```bash
   psql "postgresql://usuario:contraseña@host.render.com/portfolio_ar" -f init_db.sql
   ```

---

### 5.2 — Deploy del backend en Render

1. En Render → **"New +"** → **"Web Service"**
2. Conectar tu repositorio de GitHub (`portfolio-ar`)
3. Configurar:
   - **Name**: `portfolio-ar-api`
   - **Root Directory**: `backend`
   - **Runtime**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Plan**: Free
4. En la sección **"Environment Variables"**, agregar:

   | Key | Value |
   |-----|-------|
   | `DATABASE_URL` | (el External URL de tu DB en Render) |
   | `SECRET_KEY` | (cadena aleatoria larga, ej: resultado de `python -c "import secrets; print(secrets.token_hex(32))"`) |
   | `ALLOWED_ORIGINS` | (dejarlo vacío por ahora, completar después con la URL del frontend) |

5. Click **"Create Web Service"**
6. Esperar el primer deploy (~3-5 min)
7. Copiar la URL del servicio: `https://portfolio-ar-api.onrender.com`

---

### 5.3 — Deploy del frontend en Vercel

1. Ir a https://vercel.com → Sign up / Login con GitHub
2. Click **"New Project"**
3. Importar el repositorio `portfolio-ar`
4. Configurar:
   - **Root Directory**: `frontend`
   - **Framework Preset**: Vite (lo detecta solo)
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. En **"Environment Variables"** agregar:

   | Key | Value |
   |-----|-------|
   | `VITE_API_URL` | `https://portfolio-ar-api.onrender.com` |

6. Click **"Deploy"**
7. Vercel te da una URL: `https://portfolio-ar-xxx.vercel.app`

---

### 5.4 — Actualizar CORS del backend con la URL del frontend

Una vez tenés la URL de Vercel, volver a Render → tu Web Service → Environment:

| Key | Value |
|-----|-------|
| `ALLOWED_ORIGINS` | `https://portfolio-ar-xxx.vercel.app` |

Click **"Save Changes"** → Render redeploya automáticamente (~1 min).

---

### 5.5 — Verificar el deploy

1. Abrir la URL de Vercel
2. Registrar usuario → crear portfolio → agregar operación
3. Verificar que los precios se actualizan (yfinance corriendo en Render)

---

## Notas importantes

**Tier gratuito de Render**: el Web Service se "duerme" después de 15 min de inactividad. La primera request tarda ~30-60 segundos en despertar. Para uso personal esto está bien.

**Base de datos**: el tier gratuito de Render PostgreSQL expira a los 90 días. Para uso permanente, considerar el tier Starter (~$7/mes) o migrar a Supabase (PostgreSQL gratuito sin expiración).

**Actualizar el deploy**: cada `git push origin main` redeploya automáticamente tanto en Render como en Vercel.

```bash
# Flujo normal de trabajo
git add .
git commit -m "fix: descripción del cambio"
git push origin main
# → Render y Vercel redespliegan solos
```
