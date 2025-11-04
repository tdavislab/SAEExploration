# SAE Semantic Explorer

A visualization tool for exploring SAE (Sparse Autoencoder) features using UMAP and ball mapper. 
**Paper:** *Visual Exploration of Feature Relationships in Sparse Autoencoders with Curated Concepts* — published at the [Mechanistic Interpretability Workshop at NeurIPS 2025](https://mechinterpworkshop.com/).
**The video demo is save under this repo called `SAE-Explorer-demo.mp4`.**


## 🎬 Demo Video

<video width="640" controls>
  <source src="https://github.com/tdavislab/SAEExploration/blob/main/SAE-Explorer-demo.mp4" type="video/mp4">
</video>

## Data

1. [Download the data from Google Drive](https://drive.google.com/file/d/1x2Hs-U2VlKHjF9JYOYjU1ohDptbj3Xi5/view?usp=drive_link)
2. Unzip the downloaded file.
3. Move the extracted `data` folder into the `backend` directory so that the path is `backend/data/`.


## Structure

- `backend/` - Flask API server
- `frontend/` - React web interface

## Installation

### Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Create a virtual environment (recommended):
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```

### Frontend Setup
Tested environment:
```
Node.js version 18.20.8 (node -v)
npm version 10.8.2 (npm -v)
```

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install Node.js dependencies:
   ```bash
   npm install
   ```

## Quick Start

1. Start the backend:
   ```bash
   cd backend
   python app.py
   ```

2. Start the frontend:
   ```bash
   cd frontend
   npm start
   ```
   
## 📚 Cite Our Work
```bibtex
@inproceedings{yan2025visual,
  title={Visual Exploration of Feature Relationships in Sparse Autoencoders with Curated Concepts},
  author={Yan, Xinyuan and Liu, Shusen and Thopalli, Kowshik and Phillips, Bei Wang},
  booktitle={Mechanistic Interpretability Workshop at NeurIPS 2025}
}

