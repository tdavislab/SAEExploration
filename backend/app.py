from flask import Flask, jsonify, request
from flask_cors import CORS
import json
import os
import numpy as np
from pathlib import Path
import umap
from sklearn.metrics.pairwise import cosine_similarity
from pyballmapper import BallMapper
from sklearn.neighbors import NearestNeighbors
import kneed
from collections import defaultdict
from itertools import combinations

app = Flask(__name__)
CORS(app, origins=['http://localhost:3000', 'http://127.0.0.1:3000'])

# Data paths
DATA_DIR = Path(__file__).parent / "data"
THINGSPLUS_PATH = DATA_DIR / "thingsplus.json"
SUBJECT_PATH = DATA_DIR / "subject.json"
GEMMASCOPE_DIR = DATA_DIR / "gemmascope-res-65k"

def load_sae_embeddings(layer):
    """Load SAE embeddings for a specific layer"""
    embeddings_file = GEMMASCOPE_DIR / "SAE_directions" / f"layer_{layer}.npy"
    if embeddings_file.exists():
        return np.load(embeddings_file)
    return None

def compute_umap_coordinates(embeddings, n_components=2):
    """Compute UMAP coordinates for embeddings"""
    if embeddings is None or len(embeddings) == 0:
        return None
    
    # Normalize embeddings
    embeddings_norm = embeddings / np.linalg.norm(embeddings, axis=1, keepdims=True)
    
    # Apply UMAP
    reducer = umap.UMAP(
        n_components=n_components,
        metric='cosine',
        random_state=42
    )
    
    coordinates = reducer.fit_transform(embeddings_norm)
    return coordinates

def compute_cosine_distance_matrix(embeddings):
    """Compute cosine distance matrix from embeddings"""
    # Normalize embeddings
    embeddings_norm = embeddings / np.linalg.norm(embeddings, axis=1, keepdims=True)
    # Compute cosine similarity
    similarity_matrix = np.dot(embeddings_norm, embeddings_norm.T)
    # Convert to distance (1 - similarity) and ensure non-negative values
    distance_matrix = 1 - similarity_matrix
    # Clip to ensure all values are non-negative (handle numerical precision issues)
    distance_matrix = np.clip(distance_matrix, 0, 2)
    print(f"Distance matrix min: {distance_matrix.min()}, max: {distance_matrix.max()}")
    return distance_matrix

def elbow_eps(data, n_neighbors):
    """Find optimal epsilon using elbow method"""
    n_neighbors = 2
    nbrs = NearestNeighbors(n_neighbors=n_neighbors, metric='cosine').fit(data)
    distances, indices = nbrs.kneighbors(data)
    print(f"Distances shape: {distances.shape}")
    k_distances = np.sort(distances[:, n_neighbors-1])
    print(f"Distances: {k_distances}")
    kneedle = kneed.KneeLocator(
        range(len(k_distances)),
        k_distances, 
        curve='convex', 
        direction='increasing'
    )
    eps = int(kneedle.knee_y*100)/100
    return eps, distances[:, n_neighbors-1]

def postprocess_ballmapper(nodes, edges):
    """
    Postprocess BallMapper results:
    1. Merge nodes whose SAEs are completely contained in neighbors
    2. Remove nodes with less than 3 SAEs (noise)
    
    Args:
        nodes: List of node dictionaries
        edges: List of edge dictionaries
    
    Returns:
        tuple: (processed_nodes, processed_edges)
    """
    print(f"Starting postprocessing with {len(nodes)} nodes and {len(edges)} edges")
    
    # Convert to more manageable format
    node_dict = {node['id']: {
        'id': node['id'],
        'saes': node['saes'],
        'sae_indices': set(node['sae_indices']),
        'sae_count': node['sae_count']
    } for node in nodes}
    
    # Build adjacency list
    adjacency = defaultdict(set)
    for edge in edges:
        adjacency[edge['source']].add(edge['target'])
        adjacency[edge['target']].add(edge['source'])
    
    # Step 1: Iterative merging
    merged = True
    iteration = 0
    while merged:
        iteration += 1
        print(f"Merging iteration {iteration}")
        merged = False
        
        nodes_to_merge = []
        
        # Check each node for mergeability
        for node_id, node_data in node_dict.items():
            if node_id not in node_dict:  # Skip if already merged
                continue
                
            neighbors = adjacency[node_id]
            if not neighbors:
                continue
            
            # Check if this node's SAEs are completely contained in any neighbor
            for neighbor_id in neighbors:
                if neighbor_id not in node_dict:
                    continue
                    
                neighbor_saes = node_dict[neighbor_id]['sae_indices']
                if node_data['sae_indices'].issubset(neighbor_saes):
                    # This node can be merged into the neighbor
                    nodes_to_merge.append((node_id, neighbor_id))
                    merged = True
                    break
        
        # Perform merges
        for node_id, target_id in nodes_to_merge:
            if node_id in node_dict and target_id in node_dict:
                print(f"Merging node {node_id} into {target_id}")
                
                # Merge SAEs, ensuring no duplicates
                node_dict[target_id]['sae_indices'].update(node_dict[node_id]['sae_indices'])
                existing_indices = set(sae['index'] for sae in node_dict[target_id]['saes'])
                for sae in node_dict[node_id]['saes']:
                    if sae['index'] not in existing_indices:
                        node_dict[target_id]['saes'].append(sae)
                        existing_indices.add(sae['index'])
                node_dict[target_id]['sae_count'] = len(node_dict[target_id]['sae_indices'])
                
                # Update adjacency - redirect all connections from merged node to target
                for neighbor_id in adjacency[node_id]:
                    if neighbor_id != target_id:
                        adjacency[neighbor_id].discard(node_id)
                        adjacency[neighbor_id].add(target_id)
                        adjacency[target_id].add(neighbor_id)
                
                # Remove the merged node
                del node_dict[node_id]
                adjacency.pop(node_id, None)
    
    print(f"After merging: {len(node_dict)} nodes")
    
    # Step 2: Remove small nodes (less than 3 SAEs) - currently disabled
    nodes_to_remove = []
    # for node_id, node_data in node_dict.items():
    #     if node_data['sae_count'] < 3:
    #         nodes_to_remove.append(node_id)
    
    for node_id in nodes_to_remove:
        print(f"Removing small node {node_id} with {node_dict[node_id]['sae_count']} SAEs")
        # Remove from adjacency
        for neighbor_id in adjacency[node_id]:
            adjacency[neighbor_id].discard(node_id)
        del node_dict[node_id]
        adjacency.pop(node_id, None)
    
    print(f"After removing small nodes: {len(node_dict)} nodes")
    
    # Reconstruct nodes and edges
    processed_nodes = []
    for node_id, node_data in node_dict.items():
        processed_nodes.append({
            'id': node_data['id'],
            'saes': node_data['saes'],
            'sae_indices': list(node_data['sae_indices']),
            'sae_count': node_data['sae_count']
        })
    
    processed_edges = []
    edge_set = set()  # To avoid duplicates
    for node_id, neighbors in adjacency.items():
        for neighbor_id in neighbors:
            if node_id < neighbor_id:  # Avoid duplicate edges
                edge_key = (node_id, neighbor_id)
                if edge_key not in edge_set:
                    edge_set.add(edge_key)
                    # Find common SAEs between the two nodes
                    node1_saes = node_dict[node_id]['sae_indices']
                    node2_saes = node_dict[neighbor_id]['sae_indices']
                    common_saes = node1_saes & node2_saes
                    
                    processed_edges.append({
                        'source': node_id,
                        'target': neighbor_id,
                        'common_saes': list(common_saes)
                    })
    
    print(f"Postprocessing complete: {len(processed_nodes)} nodes, {len(processed_edges)} edges")
    return processed_nodes, processed_edges

@app.route('/api/datasets', methods=['GET'])
def get_available_datasets():
    """Get available datasets"""
    datasets = [
        {
            "id": "gemmascope-res-65k",
            "name": "GemmaScope Res-65k",
            "description": "SAE directions and explanations for GemmaScope model"
        }
    ]
    return jsonify(datasets)

@app.route('/api/concept-datasets', methods=['GET'])
def get_concept_datasets():
    """Get available concept datasets"""
    try:
        print("Concept datasets endpoint called")
        concept_datasets = [
            {
                "id": "thingsplus",
                "name": "ThingsPlus",
                "description": "Human-defined concept dataset by Helman"
            },
            {
                "id": "subject",
                "name": "SubjectConcepts",
                "description": "Subject-based concept dataset"
            }
        ]
        print(f"Returning concept datasets: {concept_datasets}")
        return jsonify(concept_datasets)
    except Exception as e:
        print(f"Error in concept-datasets endpoint: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/load-data', methods=['POST'])
def load_data():
    """Load and filter SAE data based on selected parameters"""
    data = request.json
    dataset_id = data.get('dataset_id')
    concept_dataset_id = data.get('concept_dataset_id')
    threshold = float(data.get('threshold', 0.5))
    print(f"DEBUG: threshold {threshold}, dataset {concept_dataset_id}")
    
    # Load concept data based on selected dataset
    if concept_dataset_id == "thingsplus":
        concept_data_path = THINGSPLUS_PATH
        base_dir = GEMMASCOPE_DIR / "filtered_layers_threshold_0.4_thingsplus"
    elif concept_dataset_id == "subject":
        concept_data_path = SUBJECT_PATH
        base_dir = GEMMASCOPE_DIR / "filtered_layers_threshold_0.4_subject"
    else:
        return jsonify({"error": f"Unknown concept dataset: {concept_dataset_id}"}), 400
    
    # Load concept data
    with open(concept_data_path, 'r') as f:
        concept_data = json.load(f)
    
    # Get all unique concepts
    all_concepts = set()
    for category, concepts in concept_data.items():
        for concept in concepts:
            all_concepts.add(concept['member'])
    
    total_concepts = len(all_concepts)
    
    # Check if base directory exists
    if not base_dir.exists():
        return jsonify({"error": f"Base threshold data not available for {concept_dataset_id}"}), 400
    
    layer_files = list(base_dir.glob("conceptSAE_layer_*.json"))
    layers = []
    
    for layer_file in layer_files:
        layer_num = int(layer_file.stem.split('_')[-1])
        
        # Load layer data
        with open(layer_file, 'r') as f:
            layer_data = json.load(f)
        
        # Apply dynamic filtering if threshold is not 0.4
        if threshold != 0.4:
            # Create concept to category mapping for filtering
            concept_to_category = {}
            for cat_name, concepts in concept_data.items():
                for concept in concepts:
                    concept_id = concept['uniqueID']
                    if concept_id not in concept_to_category:
                        concept_to_category[concept_id] = []
                    concept_to_category[concept_id].append(cat_name)
            
            layer_data = filter_sae_data_by_threshold(layer_data, threshold, concept_to_category)
        
        # Count unique concepts identified in this layer
        identified_concepts = set()
        for sae in layer_data:
            identified_concepts.update(sae['concept'])
        
        concept_coverage = len(identified_concepts) / total_concepts * 100
        
        layers.append({
            "layer": layer_num,
            "concept_coverage": round(concept_coverage, 2),
            "total_saes": len(layer_data),
            "identified_concepts": len(identified_concepts)
        })
    
    # Sort by layer number
    layers.sort(key=lambda x: x['layer'])
    
    return jsonify({
        "layers": layers,
        "total_concepts": total_concepts,
        "threshold": threshold,
        "concept_dataset_id": concept_dataset_id
    })

def filter_sae_data_by_threshold(layer_data, threshold, concept_to_category):
    """Filter SAE data based on threshold and recompute categories"""
    filtered_saes = []
    
    for sae in layer_data:
        # Filter concepts and cosine similarities based on threshold
        filtered_concepts = []
        filtered_cosine_similarities = []
        
        for i, cosine_sim in enumerate(sae['cosine_similarity']):
            if cosine_sim >= threshold:
                filtered_concepts.append(sae['concept'][i])
                filtered_cosine_similarities.append(cosine_sim)
        
        # If no concepts remain, skip this SAE
        if not filtered_concepts:
            continue
        
        # Create new SAE object with filtered data
        filtered_sae = {
            'index': sae['index'],
            'cosine_similarity': filtered_cosine_similarities,
            'concept': filtered_concepts,
            'frac_nonzero': sae['frac_nonzero'],
            'layer': sae['layer']
        }
        
        # Recompute categories based on remaining concepts
        all_categories = set()
        for concept in filtered_concepts:
            if concept in concept_to_category:
                all_categories.update(concept_to_category[concept])
        
        filtered_sae['all_categories'] = list(all_categories)
        filtered_saes.append(filtered_sae)
    
    return filtered_saes

@app.route('/api/layer-data/<int:layer>', methods=['GET'])
def get_layer_data(layer):
    """Get detailed data for a specific layer"""
    threshold = float(request.args.get('threshold', 0.5))
    concept_dataset_id = request.args.get('concept_dataset_id', 'thingsplus')  # Default to thingsplus for backward compatibility
    
    # Load concept data based on selected dataset
    if concept_dataset_id == "thingsplus":
        concept_data_path = THINGSPLUS_PATH
        base_dir = GEMMASCOPE_DIR / "filtered_layers_threshold_0.4_thingsplus"
    elif concept_dataset_id == "subject":
        concept_data_path = SUBJECT_PATH
        base_dir = GEMMASCOPE_DIR / "filtered_layers_threshold_0.4_subject"
    else:
        return jsonify({"error": f"Unknown concept dataset: {concept_dataset_id}"}), 400
    
    # Load concept data for category mapping
    with open(concept_data_path, 'r') as f:
        concept_data = json.load(f)
    
    # Create concept to category mapping
    concept_to_category = {}
    for category, concepts in concept_data.items():
        for concept in concepts:
            concept_id = concept['uniqueID']
            if concept_id not in concept_to_category:
                concept_to_category[concept_id] = []
            concept_to_category[concept_id].append(category)
    
    # Load from appropriate directory
    base_file = base_dir / f"conceptSAE_layer_{layer}.json"
    
    if not base_file.exists():
        return jsonify({"error": f"Layer {layer} data not found"}), 404
    
    with open(base_file, 'r') as f:
        layer_data = json.load(f)
    
    # Apply dynamic filtering based on threshold
    if threshold != 0.4:
        layer_data = filter_sae_data_by_threshold(layer_data, threshold, concept_to_category)
    
    # Load explanations and attach to each SAE
    explanations_file = GEMMASCOPE_DIR / "explanations" / f"explanations_layer_{layer}.json"
    explanations = None
    if explanations_file.exists():
        with open(explanations_file, 'r') as ef:
            try:
                explanations = json.load(ef)
            except Exception:
                explanations = None
    
    if explanations:
        for sae in layer_data:
            try:
                idx = int(sae['index'])
                sae['explanation'] = explanations[idx] if idx < len(explanations) else None
            except Exception:
                sae['explanation'] = None
    else:
        for sae in layer_data:
            sae['explanation'] = None
    
    # Load embeddings for UMAP
    embeddings = load_sae_embeddings(layer)
    
    # Filter embeddings to only include relevant SAEs (those in layer_data)
    if embeddings is not None:
        # Get indices of SAEs in the filtered data
        sae_indices = [int(sae['index']) for sae in layer_data]
        
        # Filter embeddings to only include relevant SAEs
        filtered_embeddings = embeddings[sae_indices]
        
        # Compute UMAP on filtered embeddings only
        umap_coords = compute_umap_coordinates(filtered_embeddings)
        
        # Add UMAP coordinates to each SAE (now they correspond 1:1)
        if umap_coords is not None:
            for i, sae in enumerate(layer_data):
                sae['umap_coordinates'] = umap_coords[i].tolist()
    else:
        umap_coords = None
        for sae in layer_data:
            sae['umap_coordinates'] = None

    # Calculate category distribution
    category_counts = {}
    for sae in layer_data:
        for category in sae['all_categories']:
            category_counts[category] = category_counts.get(category, 0) + 1
    
    # Sort categories by count
    sorted_categories = sorted(category_counts.items(), key=lambda x: x[1], reverse=True)
    
    return jsonify({
        "layer": layer,
        "saes": layer_data,
        "umap_coordinates": umap_coords.tolist() if umap_coords is not None else None,
        "category_distribution": [
            {"category": cat, "count": count} 
            for cat, count in sorted_categories
        ],
        "total_saes": len(layer_data)
    })

@app.route('/api/category-overlaps/<int:layer>', methods=['GET'])
def get_category_overlaps(layer):
    """Get overlap data between categories for a specific layer"""
    threshold = float(request.args.get('threshold', 0.5))
    selected_category = request.args.get('category', None)
    concept_dataset_id = request.args.get('concept_dataset_id', 'thingsplus')
    
    if not selected_category:
        return jsonify({"error": "No category specified"}), 400
    
    # Load concept data based on selected dataset
    if concept_dataset_id == "thingsplus":
        concept_data_path = THINGSPLUS_PATH
    elif concept_dataset_id == "subject":
        concept_data_path = SUBJECT_PATH
    else:
        return jsonify({"error": f"Unknown concept dataset: {concept_dataset_id}"}), 400
    
    # Load concept data for category mapping
    with open(concept_data_path, 'r') as f:
        concept_data = json.load(f)
    
    # Create concept to category mapping
    concept_to_category = {}
    for cat_name, concepts in concept_data.items():
        for concept in concepts:
            concept_id = concept['uniqueID']
            if concept_id not in concept_to_category:
                concept_to_category[concept_id] = []
            concept_to_category[concept_id].append(cat_name)
    
    # Load from appropriate directory
    if concept_dataset_id == "thingsplus":
        base_dir = GEMMASCOPE_DIR / "filtered_layers_threshold_0.4_thingsplus"
    elif concept_dataset_id == "subject":
        base_dir = GEMMASCOPE_DIR / "filtered_layers_threshold_0.4_subject"
    
    base_file = base_dir / f"conceptSAE_layer_{layer}.json"
    
    if not base_file.exists():
        return jsonify({"error": f"Layer {layer} data not found"}), 404
    
    with open(base_file, 'r') as f:
        layer_data = json.load(f)
    
    # Apply dynamic filtering based on threshold
    if threshold != 0.4:
        layer_data = filter_sae_data_by_threshold(layer_data, threshold, concept_to_category)
    
    # Create category to SAE indices mapping
    category_to_saes = {}
    for sae in layer_data:
        for category in sae['all_categories']:
            if category not in category_to_saes:
                category_to_saes[category] = set()
            category_to_saes[category].add(sae['index'])
    
    # Calculate overlaps with selected category
    overlaps = {}
    if selected_category in category_to_saes:
        selected_saes = category_to_saes[selected_category]
        
        for category, sae_indices in category_to_saes.items():
            if category != selected_category:
                # Calculate intersection
                intersection = selected_saes.intersection(sae_indices)
                overlap_count = len(intersection)
                overlap_percentage = (overlap_count / len(sae_indices)) * 100 if len(sae_indices) > 0 else 0
                
                overlaps[category] = {
                    "overlap_count": overlap_count,
                    "overlap_percentage": round(overlap_percentage, 1)
                }
    
    return jsonify({
        "selected_category": selected_category,
        "overlaps": overlaps
    })

@app.route('/api/pinned-category-overlaps/<int:layer>', methods=['GET'])
def get_pinned_category_overlaps(layer):
    """Get overlap data for reordering categories when one is pinned"""
    threshold = float(request.args.get('threshold', 0.5))
    pinned_category = request.args.get('pinned_category', None)
    concept_dataset_id = request.args.get('concept_dataset_id', 'thingsplus')
    
    if not pinned_category:
        return jsonify({"error": "No pinned category specified"}), 400
    
    # Load concept data based on selected dataset
    if concept_dataset_id == "thingsplus":
        concept_data_path = THINGSPLUS_PATH
        base_dir = GEMMASCOPE_DIR / "filtered_layers_threshold_0.4_thingsplus"
    elif concept_dataset_id == "subject":
        concept_data_path = SUBJECT_PATH
        base_dir = GEMMASCOPE_DIR / "filtered_layers_threshold_0.4_subject"
    else:
        return jsonify({"error": f"Unknown concept dataset: {concept_dataset_id}"}), 400
    
    # Load concept data for category mapping
    with open(concept_data_path, 'r') as f:
        concept_data = json.load(f)
    
    # Create concept to category mapping
    concept_to_category = {}
    for cat_name, concepts in concept_data.items():
        for concept in concepts:
            concept_id = concept['uniqueID']
            if concept_id not in concept_to_category:
                concept_to_category[concept_id] = []
            concept_to_category[concept_id].append(cat_name)
    
    # Load from appropriate directory
    base_file = base_dir / f"conceptSAE_layer_{layer}.json"
    
    if not base_file.exists():
        return jsonify({"error": f"Layer {layer} data not found"}), 404
    
    with open(base_file, 'r') as f:
        layer_data = json.load(f)
    
    # Apply dynamic filtering based on threshold
    if threshold != 0.4:
        layer_data = filter_sae_data_by_threshold(layer_data, threshold, concept_to_category)
    
    # Create category to SAE indices mapping
    category_to_saes = {}
    for sae in layer_data:
        for category in sae['all_categories']:
            if category not in category_to_saes:
                category_to_saes[category] = set()
            category_to_saes[category].add(sae['index'])
    
    # Calculate overlaps with pinned category and create ordered list
    category_overlaps = []
    if pinned_category in category_to_saes:
        pinned_saes = category_to_saes[pinned_category]
        
        for category, sae_indices in category_to_saes.items():
            if category != pinned_category:
                # Calculate intersection
                intersection = pinned_saes.intersection(sae_indices)
                overlap_count = len(intersection)
                overlap_percentage = (overlap_count / len(sae_indices)) * 100 if len(sae_indices) > 0 else 0
                
                category_overlaps.append({
                    "category": category,
                    "count": len(sae_indices),
                    "overlap_count": overlap_count,
                    "overlap_percentage": round(overlap_percentage, 1)
                })
    
    # Sort by overlap count (descending) - number of overlapping SAEs
    category_overlaps.sort(key=lambda x: x['overlap_count'], reverse=True)
    
    return jsonify({
        "pinned_category": pinned_category,
        "ordered_categories": category_overlaps
    })

@app.route('/api/sae-details/<int:layer>/<int:sae_index>', methods=['GET'])
def get_sae_details(layer, sae_index):
    """Get detailed information for a specific SAE"""
    threshold = float(request.args.get('threshold', 0.5))
    concept_dataset_id = request.args.get('concept_dataset_id', 'thingsplus')
    
    # Load concept data based on selected dataset
    if concept_dataset_id == "thingsplus":
        concept_data_path = THINGSPLUS_PATH
        base_dir = GEMMASCOPE_DIR / "filtered_layers_threshold_0.4_thingsplus"
    elif concept_dataset_id == "subject":
        concept_data_path = SUBJECT_PATH
        base_dir = GEMMASCOPE_DIR / "filtered_layers_threshold_0.4_subject"
    else:
        return jsonify({"error": f"Unknown concept dataset: {concept_dataset_id}"}), 400
    
    # Load concept data for category mapping
    with open(concept_data_path, 'r') as f:
        concept_data = json.load(f)
    
    # Create concept to category mapping
    concept_to_category = {}
    for cat_name, concepts in concept_data.items():
        for concept in concepts:
            concept_id = concept['uniqueID']
            if concept_id not in concept_to_category:
                concept_to_category[concept_id] = []
            concept_to_category[concept_id].append(cat_name)
    
    # Load from appropriate directory
    base_file = base_dir / f"conceptSAE_layer_{layer}.json"
    
    if not base_file.exists():
        return jsonify({"error": f"Layer {layer} data not found"}), 404
    
    with open(base_file, 'r') as f:
        layer_data = json.load(f)
    
    # Apply dynamic filtering based on threshold
    if threshold != 0.4:
        layer_data = filter_sae_data_by_threshold(layer_data, threshold, concept_to_category)
    
    # Find the specific SAE
    sae = None
    for s in layer_data:
        if int(s['index']) == sae_index:
            sae = s
            break
    
    if not sae:
        return jsonify({"error": f"SAE {sae_index} not found in layer {layer}"}), 404
    
    # Load explanation if available
    explanation = None
    explanations_file = GEMMASCOPE_DIR / "explanations" / f"explanations_layer_{layer}.json"
    if explanations_file.exists():
        with open(explanations_file, 'r') as f:
            explanations = json.load(f)
            if sae_index < len(explanations):
                explanation = explanations[sae_index]
    
    return jsonify({
        "sae": sae,
        "explanation": explanation
    })

@app.route('/api/nearest-saes/<int:layer>/<int:sae_index>', methods=['GET'])
def get_nearest_saes(layer, sae_index):
    """Get top 3 nearest SAEs based on cosine similarity"""
    threshold = float(request.args.get('threshold', 0.5))
    category = request.args.get('category', None)  # Single category filtering (for backward compatibility)
    categories = request.args.get('categories', None)  # Multiple categories filtering (for comparison mode)
    concept_dataset_id = request.args.get('concept_dataset_id', 'thingsplus')
    
    # Load concept data based on selected dataset
    if concept_dataset_id == "thingsplus":
        concept_data_path = THINGSPLUS_PATH
        base_dir = GEMMASCOPE_DIR / "filtered_layers_threshold_0.4_thingsplus"
    elif concept_dataset_id == "subject":
        concept_data_path = SUBJECT_PATH
        base_dir = GEMMASCOPE_DIR / "filtered_layers_threshold_0.4_subject"
    else:
        return jsonify({"error": f"Unknown concept dataset: {concept_dataset_id}"}), 400
    
    # Load concept data for category mapping
    with open(concept_data_path, 'r') as f:
        concept_data = json.load(f)
    
    # Create concept to category mapping
    concept_to_category = {}
    for cat_name, concepts in concept_data.items():
        for concept in concepts:
            concept_id = concept['uniqueID']
            if concept_id not in concept_to_category:
                concept_to_category[concept_id] = []
            concept_to_category[concept_id].append(cat_name)
    
    # Load from appropriate directory
    base_file = base_dir / f"conceptSAE_layer_{layer}.json"
    
    if not base_file.exists():
        return jsonify({"error": f"Layer {layer} data not found"}), 404
    
    with open(base_file, 'r') as f:
        layer_data = json.load(f)
    
    # Apply dynamic filtering based on threshold
    if threshold != 0.4:
        layer_data = filter_sae_data_by_threshold(layer_data, threshold, concept_to_category)
    
    # Parse categories if provided
    if categories:
        try:
            categories_list = json.loads(categories)
            print(f"Categories filter for nearest features: {categories_list}")
        except json.JSONDecodeError:
            categories_list = None
            print(f"Invalid categories JSON: {categories}")
    else:
        categories_list = None
    
    # Find the target SAE in the full dataset (not filtered by category)
    target_sae = None
    target_idx = None
    for i, sae in enumerate(layer_data):
        if int(sae['index']) == sae_index:
            target_sae = sae
            target_idx = i
            break
    
    if not target_sae:
        print(f"SAE {sae_index} not found in data. Total SAEs: {len(layer_data)}, Threshold: {threshold}")
        return jsonify({"error": f"Feature {sae_index} not found in data (threshold: {threshold})"}), 404
    
    # Load embeddings
    embeddings = load_sae_embeddings(layer)
    if embeddings is None:
        return jsonify({"error": "Embeddings not found"}), 404
    
    # Get indices of all SAEs (not filtered by category for better nearest neighbor computation)
    all_sae_indices = [int(sae['index']) for sae in layer_data]
    
    # Use all embeddings for nearest neighbor computation
    all_embeddings = embeddings[all_sae_indices]
    
    # Compute cosine similarity between target SAE and all others
    target_embedding = all_embeddings[target_idx].reshape(1, -1)
    similarities = cosine_similarity(target_embedding, all_embeddings)[0]
    
    # Create list of (similarity, sae_index, sae_data) tuples, excluding self
    sae_similarities = []
    for i, similarity in enumerate(similarities):
        if i != target_idx:  # Exclude self
            sae_similarities.append((similarity, all_sae_indices[i], layer_data[i]))
    
    # Sort by similarity (descending) and get top 3
    sae_similarities.sort(key=lambda x: x[0], reverse=True)
    top_3 = sae_similarities[:3]
    
    # Load explanations
    explanations_file = GEMMASCOPE_DIR / "explanations" / f"explanations_layer_{layer}.json"
    explanations = None
    if explanations_file.exists():
        with open(explanations_file, 'r') as ef:
            try:
                explanations = json.load(ef)
            except Exception:
                explanations = None
    
    # Format results
    nearest_saes = []
    for similarity, sae_idx, sae_data in top_3:
        explanation = None
        if explanations and sae_idx < len(explanations):
            explanation = explanations[sae_idx]
        
        nearest_saes.append({
            "index": sae_idx,
            "similarity": float(similarity),
            "explanation": explanation,
            "concepts": sae_data.get('concept', []),
            "categories": sae_data.get('all_categories', [])
        })
    
    return jsonify({
        "nearest_saes": nearest_saes
    })

@app.route('/api/layer/<int:layer>/ballmapper', methods=['GET'])
def get_ballmapper(layer):
    """Get ballmapper for a specific layer"""
    try:
        # Get parameters
        threshold = float(request.args.get('threshold', 0.5))
        category = request.args.get('category', None)  # Single category filtering (for backward compatibility)
        categories = request.args.get('categories', None)  # Multiple categories filtering (for comparison mode)
        concept_dataset_id = request.args.get('concept_dataset_id', 'thingsplus')
        custom_epsilon = request.args.get('epsilon', None)  # Custom epsilon value
        # Optional: cap on maximum number of overlapping balls per point in BallMapper
        try:
            max_size_param = request.args.get('max_size', None)
            max_size = int(max_size_param) if max_size_param is not None else 3
            if max_size < 1:
                max_size = 1
        except Exception:
            max_size = 3
        
        # Parse categories if provided
        if categories:
            try:
                categories_list = json.loads(categories)
                print(f"Categories filter for BallMapper: {categories_list}")
            except json.JSONDecodeError:
                categories_list = None
                print(f"Invalid categories JSON: {categories}")
        else:
            categories_list = None
        
        print(f"Category filter for BallMapper: {category}")
        print(f"Categories filter for BallMapper: {categories_list}")
        
        # Load concept data based on selected dataset
        if concept_dataset_id == "thingsplus":
            concept_data_path = THINGSPLUS_PATH
            base_dir = GEMMASCOPE_DIR / "filtered_layers_threshold_0.4_thingsplus"
        elif concept_dataset_id == "subject":
            concept_data_path = SUBJECT_PATH
            base_dir = GEMMASCOPE_DIR / "filtered_layers_threshold_0.4_subject"
        else:
            return jsonify({"error": f"Unknown concept dataset: {concept_dataset_id}"}), 400
        
        # Load concept data for category mapping
        with open(concept_data_path, 'r') as f:
            concept_data = json.load(f)
        
        # Create concept to category mapping
        concept_to_category = {}
        for cat_name, concepts in concept_data.items():
            for concept in concepts:
                concept_id = concept['uniqueID']
                if concept_id not in concept_to_category:
                    concept_to_category[concept_id] = []
                concept_to_category[concept_id].append(cat_name)
        
        # Load from appropriate directory
        base_file = base_dir / f"conceptSAE_layer_{layer}.json"
        
        if not base_file.exists():
            return jsonify({"error": f"Layer {layer} data not found"}), 404
        
        with open(base_file, 'r') as f:
            sae_data = json.load(f)
        
        # Apply dynamic filtering based on threshold
        if threshold != 0.4:
            sae_data = filter_sae_data_by_threshold(sae_data, threshold, concept_to_category)
        
        # Load explanations and attach to each SAE
        explanations_file = GEMMASCOPE_DIR / "explanations" / f"explanations_layer_{layer}.json"
        explanations = None
        if explanations_file.exists():
            with open(explanations_file, 'r') as ef:
                try:
                    explanations = json.load(ef)
                except Exception:
                    explanations = None
        
        if explanations:
            for sae in sae_data:
                try:
                    idx = int(sae['index'])
                    sae['explanation'] = explanations[idx] if idx < len(explanations) else None
                except Exception:
                    sae['explanation'] = None
        else:
            for sae in sae_data:
                sae['explanation'] = None
        
        # Load embeddings
        embeddings = load_sae_embeddings(layer)
        
        # Filter SAEs by category if specified
        print(f"Category parameter received: '{category}'")
        print(f"Categories parameter received: '{categories_list}'")
        
        if categories_list:
            # Filter by multiple categories (comparison mode)
            filtered_sae_data = [sae for sae in sae_data if any(cat in sae['all_categories'] for cat in categories_list)]
            print(f"Filtered SAEs for BallMapper categories {categories_list}: {len(filtered_sae_data)} out of {len(sae_data)}")
        elif category:
            # Filter by single category (backward compatibility)
            filtered_sae_data = [sae for sae in sae_data if category in sae['all_categories']]
            print(f"Filtered SAEs for BallMapper category '{category}': {len(filtered_sae_data)} out of {len(sae_data)}")
            # Debug: show some sample categories from the data
            sample_categories = set()
            for sae in sae_data[:5]:  # First 5 SAEs
                sample_categories.update(sae.get('all_categories', []))
            print(f"Sample categories in data: {list(sample_categories)[:10]}")
        else:
            # Show all nodes - concept highlighting will be done in frontend
            filtered_sae_data = sae_data
            print(f"No filter applied to BallMapper, using all {len(sae_data)} SAEs (concept highlighting will be done in frontend)")
        
        # Check if we have any SAEs to work with
        if len(filtered_sae_data) == 0:
            return jsonify({
                "error": f"No SAEs found for the given filter (category: {category}, concept: {concept})",
                "category": category,
                "concept": concept,
                "total_saes": len(sae_data)
            }), 404
        
        # Filter embeddings to only include relevant SAEs
        if embeddings is not None:
            # Create mapping from SAE index to position in embeddings array
            sae_index_to_position = {i: i for i in range(len(embeddings))}
            
            # Use the same SAE indices for both concept search and BallMapper
            all_sae_indices = [int(sae['index']) for sae in sae_data]
            sae_indices = [int(sae['index']) for sae in filtered_sae_data]
            
            print(f"SAE index ranges - All: {min(all_sae_indices)} to {max(all_sae_indices)}, Filtered: {min(sae_indices)} to {max(sae_indices)}")
            
            # Map SAE indices to positions in embeddings array
            filtered_embeddings_positions = [sae_index_to_position[idx] for idx in sae_indices]
            all_embeddings_positions = [sae_index_to_position[idx] for idx in all_sae_indices]
            
            filtered_embeddings = embeddings[filtered_embeddings_positions]
            all_filtered_embeddings = embeddings[all_embeddings_positions]
            print(f"All SAEs: {len(all_sae_indices)}")
            print(f"Filtered SAEs: {len(sae_indices)}")
            print(f"Embeddings shape: {embeddings.shape}")
            print(f"Filtered embeddings shape: {filtered_embeddings.shape}")
            
            # Compute distance matrix and optimal epsilon
            cosine_distance_matrix = compute_cosine_distance_matrix(filtered_embeddings)
            eps, distances = elbow_eps(all_filtered_embeddings, 3)
            print(f"Elbow eps: {eps}")
            
            # Use custom epsilon if provided, otherwise use computed epsilon
            if custom_epsilon is not None:
                eps = float(custom_epsilon)
                print(f"Using custom epsilon: {eps}")
            else:
                print(f"Using computed epsilon: {eps}")
                
            print(f"Filtered embeddings shape: {filtered_embeddings.shape}")
            print(f"Distance matrix shape: {cosine_distance_matrix.shape}")

            # Apply BallMapper
            bm = BallMapper(
                metric="precomputed",  # the metric to use for distance
                X=cosine_distance_matrix, 
                eps=eps, # The radius of the balls.  
                # verbose="tqdm", # Verbose output 
                method="adaptive",
                max_size=max_size,
                eta=0.9
            )
            
            # Convert to graph format
            nodes = []
            edges = []
            
            # Create nodes
            mapper_nodes = bm.Graph.nodes
            print(f"Number of nodes: {len(mapper_nodes)}")
            
            for id, node in enumerate(mapper_nodes):
                node = mapper_nodes[id]
                node_sae_indices = node['points covered']
                # Map filtered indices back to original SAE indices
                original_sae_indices = [sae_indices[sae_index] for sae_index in node_sae_indices]
                # Get full SAE data for the indices in this node
                node_saes = [filtered_sae_data[sae_index] for sae_index in node_sae_indices]
                
                nodes.append({
                    'id': node['landmark'],
                    'saes': node_saes,
                    'sae_indices': original_sae_indices,
                    'sae_count': len(node_saes)
                })
            
            # Create edges
            for node1, node2 in combinations(nodes, 2):
                node1_saes = node1["sae_indices"]
                node2_saes = node2["sae_indices"]
                # if the two nodes have any common saes, add an edge
                common_saes = set(node1_saes) & set(node2_saes)
                if len(common_saes) > 0:
                    edges.append({
                        "source": node1["id"],
                        "target": node2["id"],
                        "common_saes": list(common_saes)
                    }) 
            
            # Apply postprocessing
            print("Applying postprocessing to BallMapper results...")
            processed_nodes, processed_edges = postprocess_ballmapper(nodes, edges)
            
            return jsonify({
                'category_filter': category,
                'nodes': processed_nodes,
                'edges': processed_edges,
                'total_saes': len(filtered_sae_data),
                'original_total_saes': len(sae_data),
                'original_nodes': len(nodes),
                'original_edges': len(edges),
                'computed_epsilon': float(eps) if custom_epsilon is None else None,
                'used_epsilon': float(eps)
            })
        else:
            return jsonify({"error": "No embeddings found for this layer"}), 404
        
    except Exception as e:
        print(f"Error in BallMapper: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/concepts/<int:layer>', methods=['GET'])
def get_available_concepts(layer):
    """Get all available concepts for a specific layer"""
    threshold = float(request.args.get('threshold', 0.5))
    concept_dataset_id = request.args.get('concept_dataset_id', 'thingsplus')
    
    # Load concept data based on selected dataset
    if concept_dataset_id == "thingsplus":
        concept_data_path = THINGSPLUS_PATH
        base_dir = GEMMASCOPE_DIR / "filtered_layers_threshold_0.4_thingsplus"
    elif concept_dataset_id == "subject":
        concept_data_path = SUBJECT_PATH
        base_dir = GEMMASCOPE_DIR / "filtered_layers_threshold_0.4_subject"
    else:
        return jsonify({"error": f"Unknown concept dataset: {concept_dataset_id}"}), 400
    
    # Load concept data for category mapping
    with open(concept_data_path, 'r') as f:
        concept_data = json.load(f)
    
    # Create concept to category mapping
    concept_to_category = {}
    for cat_name, concepts in concept_data.items():
        for concept in concepts:
            concept_id = concept['uniqueID']
            if concept_id not in concept_to_category:
                concept_to_category[concept_id] = []
            concept_to_category[concept_id].append(cat_name)
    
    # Load from appropriate directory
    base_file = base_dir / f"conceptSAE_layer_{layer}.json"
    
    if not base_file.exists():
        return jsonify({"error": f"Layer {layer} data not found"}), 404
    
    with open(base_file, 'r') as f:
        layer_data = json.load(f)
    
    # Apply dynamic filtering based on threshold
    if threshold != 0.4:
        layer_data = filter_sae_data_by_threshold(layer_data, threshold, concept_to_category)
    
    # Extract all unique concepts
    all_concepts = set()
    for sae in layer_data:
        all_concepts.update(sae.get('concept', []))
    
    # Sort concepts alphabetically
    sorted_concepts = sorted(list(all_concepts))
    
    return jsonify({
        "layer": layer,
        "concepts": sorted_concepts,
        "total_concepts": len(sorted_concepts)
    })

@app.route('/api/search-concept/<int:layer>', methods=['GET'])
def search_concept(layer):
    """Search for SAEs containing a specific concept"""
    concept = request.args.get('concept', '')
    threshold = float(request.args.get('threshold', 0.5))
    concept_dataset_id = request.args.get('concept_dataset_id', 'thingsplus')
    
    if not concept:
        return jsonify({"error": "Concept parameter is required"}), 400
    
    # Load concept data based on selected dataset
    if concept_dataset_id == "thingsplus":
        concept_data_path = THINGSPLUS_PATH
        base_dir = GEMMASCOPE_DIR / "filtered_layers_threshold_0.4_thingsplus"
    elif concept_dataset_id == "subject":
        concept_data_path = SUBJECT_PATH
        base_dir = GEMMASCOPE_DIR / "filtered_layers_threshold_0.4_subject"
    else:
        return jsonify({"error": f"Unknown concept dataset: {concept_dataset_id}"}), 400
    
    # Load concept data for category mapping
    with open(concept_data_path, 'r') as f:
        concept_data = json.load(f)
    
    # Create concept to category mapping
    concept_to_category = {}
    for cat_name, concepts in concept_data.items():
        for concept_obj in concepts:
            concept_id = concept_obj['uniqueID']
            if concept_id not in concept_to_category:
                concept_to_category[concept_id] = []
            concept_to_category[concept_id].append(cat_name)
    
    # Load from appropriate directory
    base_file = base_dir / f"conceptSAE_layer_{layer}.json"
    
    if not base_file.exists():
        return jsonify({"error": f"Layer {layer} data not found"}), 404
    
    with open(base_file, 'r') as f:
        layer_data = json.load(f)
    
    # Apply dynamic filtering based on threshold
    print(f"Search concept '{concept}': Before threshold filtering: {len(layer_data)} SAEs")
    if threshold != 0.4:
        layer_data = filter_sae_data_by_threshold(layer_data, threshold, concept_to_category)
        print(f"Search concept '{concept}': After threshold filtering: {len(layer_data)} SAEs")
    
    # Find SAEs containing the concept
    matching_sae_indices = []
    concept_found_count = 0
    
    # Debug: Check all available concepts
    all_concepts_in_data = set()
    for sae in layer_data:
        all_concepts_in_data.update(sae.get('concept', []))
    
    print(f"Search concept '{concept}': Available concepts (first 20): {sorted(list(all_concepts_in_data))[:20]}")
    print(f"Search concept '{concept}': Concept exists in data: {concept in all_concepts_in_data}")
    
    for sae in layer_data:
        if concept in sae.get('concept', []):
            matching_sae_indices.append(sae['index'])
            concept_found_count += 1
    
    print(f"Search concept '{concept}': Found {concept_found_count} SAEs containing the concept")
    print(f"Search concept '{concept}': Matching SAE indices: {matching_sae_indices[:10]}")  # Show first 10
    print(f"Search concept '{concept}': Sample concepts from first 5 SAEs: {[sae.get('concept', [])[:3] for sae in layer_data[:5]]}")
    
    # Calculate category distribution for matching SAEs
    category_counts = defaultdict(int)
    for sae in layer_data:
        if sae['index'] in matching_sae_indices:
            for cat in sae.get('all_categories', []):
                category_counts[cat] += 1
    
    category_distribution = [
        {"category": cat, "count": count} 
        for cat, count in category_counts.items()
    ]
    category_distribution.sort(key=lambda x: x['count'], reverse=True)
    
    return jsonify({
        "layer": layer,
        "concept": concept,
        "matching_sae_indices": matching_sae_indices,
        "total_matching_saes": len(matching_sae_indices),
        "category_distribution": category_distribution
    })

if __name__ == '__main__':
    app.run(debug=True, port=5001)
