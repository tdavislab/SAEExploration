import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Chip,
  Modal,
  ModalDialog
} from '@mui/joy';
import UMAPVisualization from './UMAPVisualization';
import BallMapperVisualization from './BallMapperVisualization';

const VisualizationArea = ({ layerDetails, selectedCategory, currentLayer, conceptSearchResults, pinnedCategory, comparisonCategory, currentThreshold, currentConceptDataset }) => {
  const [selectedSAEs, setSelectedSAEs] = useState([]);
  const [highlightedSAEIndices, setHighlightedSAEIndices] = useState([]);
  const [selectedBallMapperNodeId, setSelectedBallMapperNodeId] = useState(null);
  const [selectedBallMapperEdge, setSelectedBallMapperEdge] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [targetLayer, setTargetLayer] = useState(null);
  const [nearestSAEsData, setNearestSAEsData] = useState({});
  const [nearestNeighborIndices, setNearestNeighborIndices] = useState([]);
  const [lassoSelectedSAEs, setLassoSelectedSAEs] = useState([]);
  
  // Loading state management for visualizations
  const [umapLoaded, setUmapLoaded] = useState(false);
  const [ballMapperLoaded, setBallMapperLoaded] = useState(false);
  
  // Ref to track if we've fetched nearest features for current search results
  const fetchedForSearchRef = useRef(false);

  // Check if we're in comparison mode
  const isComparisonMode = pinnedCategory && comparisonCategory && pinnedCategory !== comparisonCategory;
  
  console.log('Comparison mode state:', {
    pinnedCategory,
    comparisonCategory,
    isComparisonMode,
    selectedCategory
  });

  // Clear highlights when category changes
  useEffect(() => {
    setHighlightedSAEIndices([]);
    setSelectedSAEs([]);
    setSelectedBallMapperNodeId(null);
    setSelectedBallMapperEdge(null);
    setNearestSAEsData({});
    setNearestNeighborIndices([]);
    setLassoSelectedSAEs([]);
  }, [selectedCategory]);

  // Clear all selections when concept search is performed or cleared
  useEffect(() => {
    if (conceptSearchResults) {
      console.log('Concept search detected - clearing all previous selections');
      // Clear all selections and highlighting immediately
      setSelectedBallMapperNodeId(null);
      setSelectedBallMapperEdge(null);
      setNearestSAEsData({});
      setNearestNeighborIndices([]);
      setLassoSelectedSAEs([]);
      setHighlightedSAEIndices([]);
      setSelectedSAEs([]);
      fetchedForSearchRef.current = false; // Reset the fetch flag
      
      // Don't set search results as highlightedSAEIndices - let UMAP handle them separately
      setTimeout(async () => {
        if (conceptSearchResults.matchingSaeIndices) {
          console.log('Search results available:', conceptSearchResults.matchingSaeIndices.length, 'SAEs');
          
          // Find and set the corresponding SAE objects for display
          const matchingSAEs = layerDetails.saes.filter(sae => 
            conceptSearchResults.matchingSaeIndices.includes(String(sae.index))
          );
          setSelectedSAEs(matchingSAEs);
        }
      }, 50); // Small delay to ensure clearing happens first
    } else {
      // Concept search was cleared - clear all highlighting and selections
      console.log('Concept search cleared - clearing all highlighting and selections');
      setSelectedBallMapperNodeId(null);
      setSelectedBallMapperEdge(null);
      setNearestSAEsData({});
      setNearestNeighborIndices([]);
      setLassoSelectedSAEs([]);
      setHighlightedSAEIndices([]);
      setSelectedSAEs([]);
      fetchedForSearchRef.current = false; // Reset the fetch flag
    }
  }, [conceptSearchResults?.concept, conceptSearchResults?.matchingSaeIndices, layerDetails?.saes]); // Trigger when concept or results change

  // Fetch nearest features for SAEs when they are displayed due to concept search
  useEffect(() => {
    if (conceptSearchResults && selectedSAEs.length > 0 && !fetchedForSearchRef.current) {
      // Only fetch if we have concept search results, selected SAEs, but haven't fetched yet
      fetchedForSearchRef.current = true; // Mark as fetched to prevent duplicate calls
      
      const fetchNearestForSearchResults = async () => {
        console.log('Fetching nearest features for all search result SAEs...');
        const nearestData = {};
        for (const sae of selectedSAEs) {
          const nearestSAEs = await fetchNearestSAEs(sae.index);
          if (nearestSAEs) {
            nearestData[sae.index] = nearestSAEs;
          }
        }
        setNearestSAEsData(nearestData);
        console.log('Fetched nearest features for', Object.keys(nearestData).length, 'SAEs');
      };
      
      fetchNearestForSearchResults();
    }
  }, [selectedSAEs, conceptSearchResults]);

  // Function to fetch nearest SAEs for a given SAE
  const fetchNearestSAEs = useCallback(async (saeIndex) => {
    try {
      console.log(`Fetching nearest features for feature ${saeIndex} in layer ${currentLayer} with category: ${selectedCategory}, pinnedCategory: ${pinnedCategory}, comparisonCategory: ${comparisonCategory}`);
      
      const params = new URLSearchParams({
        threshold: currentThreshold.toString(),
        concept_dataset_id: currentConceptDataset
      });
      
      // Handle comparison mode vs normal mode
      if (isComparisonMode && pinnedCategory && comparisonCategory) {
        // In comparison mode, pass both categories
        const categories = [pinnedCategory, comparisonCategory];
        params.append('categories', JSON.stringify(categories));
        console.log(`Comparison mode: passing categories ${categories}`);
      } else if (selectedCategory) {
        // In normal mode, pass single category
        params.append('category', selectedCategory);
        console.log(`Normal mode: passing category ${selectedCategory}`);
      }
      
      const url = `http://127.0.0.1:5001/api/nearest-saes/${currentLayer}/${saeIndex}?${params}`;
      console.log('Fetching URL:', url);
      
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        console.log(`Successfully fetched ${data.nearest_saes.length} nearest features for feature ${saeIndex}`);
        return data.nearest_saes;
      } else {
        const errorData = await response.json();
        console.error(`Error fetching nearest features for feature ${saeIndex}:`, errorData.error);
        return null;
      }
    } catch (error) {
      console.error(`Error fetching nearest features for feature ${saeIndex}:`, error);
      return null;
    }
  }, [currentLayer, selectedCategory, pinnedCategory, comparisonCategory, isComparisonMode, currentThreshold, currentConceptDataset]);

  // Callback for UMAP point selection
  const handleUMAPPointClick = useCallback(async (saeIndex) => {
    console.log("🎯 UMAP POINT CLICKED:", saeIndex, typeof saeIndex);
    
    const stringIndex = String(saeIndex);
    
    // Check if this point is already selected (orange)
    const isCurrentlySelected = highlightedSAEIndices.includes(stringIndex);
    
    if (isCurrentlySelected) {
      // Toggle off - deselect the point but show all search results
      console.log("🎯 DESELECTING point:", saeIndex);
      setHighlightedSAEIndices([]);
      setNearestNeighborIndices([]);
      setNearestSAEsData({});
      setSelectedBallMapperNodeId(null);
      setSelectedBallMapperEdge(null);
      setLassoSelectedSAEs([]);
      
      // Show all search results in the detail view
      if (conceptSearchResults && conceptSearchResults.matchingSaeIndices) {
        const allSearchSAEs = layerDetails.saes.filter(sae => 
          conceptSearchResults.matchingSaeIndices.includes(String(sae.index))
        );
        setSelectedSAEs(allSearchSAEs);
        console.log("🎯 Showing all search results in detail view:", allSearchSAEs.length, "SAEs");
      }
    } else {
      // Select the point
      console.log("🎯 SELECTING point:", saeIndex);
      setHighlightedSAEIndices([stringIndex]);
      setSelectedSAEs([layerDetails?.saes?.find(sae => sae.index === saeIndex)]);
      setSelectedBallMapperNodeId(null);
      setSelectedBallMapperEdge(null);
      setLassoSelectedSAEs([]);
      
      // Fetch nearest SAEs
      const nearestSAEs = await fetchNearestSAEs(saeIndex);
      if (nearestSAEs) {
        setNearestSAEsData(prev => ({
          ...prev,
          [saeIndex]: nearestSAEs
        }));
        
        const neighborIndices = nearestSAEs.map(sae => String(sae.index));
        console.log("🎯 Setting nearest neighbor indices:", neighborIndices);
        setNearestNeighborIndices(neighborIndices);
      }
    }
  }, [layerDetails, highlightedSAEIndices, fetchNearestSAEs]);

  // Show loading when layer changes or when layerDetails is null
  useEffect(() => {
    if (currentLayer !== undefined) {
      setTargetLayer(currentLayer);
      setIsLoading(true);
      // Reset loading states for visualizations
      setUmapLoaded(false);
      setBallMapperLoaded(false);
    }
  }, [currentLayer]); // Only trigger when currentLayer changes, not currentThreshold

  // Hide loading when both visualizations are ready
  useEffect(() => {
    if (umapLoaded && ballMapperLoaded) {
      console.log('Both UMAP and BallMapper loaded, hiding loading overlay');
      setIsLoading(false);
    }
  }, [umapLoaded, ballMapperLoaded]);

  // Show loading when layerDetails is null (initial loading)
  useEffect(() => {
    if (currentLayer !== undefined && !layerDetails) {
      setIsLoading(true);
      setUmapLoaded(false);
      setBallMapperLoaded(false);
    }
  }, [currentLayer, layerDetails]);

  // Callbacks for visualization loading states
  const handleUmapLoaded = useCallback(() => {
    console.log('UMAP visualization loaded');
    setUmapLoaded(true);
  }, []);

  const handleBallMapperLoaded = useCallback(() => {
    console.log('BallMapper visualization loaded');
    setBallMapperLoaded(true);
  }, []);

  // Check if layerDetails is available
  if (!layerDetails || !layerDetails.saes) {
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 0.25, overflow: 'hidden', position: 'relative' }}>
        {/* Loading Overlay */}
        <Modal open={isLoading} sx={{ zIndex: 1000 }}>
          <ModalDialog
            sx={{
              backgroundColor: 'rgba(255, 255, 255, 0.98)',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              p: 5,
              borderRadius: 3,
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              '@keyframes pulse': {
                '0%, 100%': { opacity: 1 },
                '50%': { opacity: 0.7 }
              },
              '@keyframes spin': {
                '0%': { transform: 'rotate(0deg)' },
                '100%': { transform: 'rotate(360deg)' }
              }
            }}
          >
            {/* Modern Loading Spinner */}
            <Box sx={{ position: 'relative', width: 80, height: 80 }}>
              <Box sx={{ 
                position: 'absolute',
                width: '100%',
                height: '100%',
                border: '3px solid #f0f0f0',
                borderRadius: '50%'
              }} />
              <Box sx={{ 
                position: 'absolute',
                width: '100%',
                height: '100%',
                border: '3px solid transparent',
                borderTop: '3px solid #1976d2',
                borderRight: '3px solid #1976d2',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }} />
            </Box>
            
            <Typography level="h5" color="primary" sx={{ fontWeight: 600 }}>
              Loading Layer {targetLayer}...
            </Typography>
            <Typography level="body-md" color="neutral.500" sx={{ textAlign: 'center' }}>
              Fetching layer data and computing visualizations
            </Typography>
          </ModalDialog>
        </Modal>
        
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <Typography level="h6">
            No layer data available
          </Typography>
        </Box>
      </Box>
    );
  }

  // Filter SAEs based on selected category (used in callbacks)

  // Callback for BallMapper node selection
  const handleBallMapperNodeClick = async (node) => {
    console.log("=== BallMapper Node Click Debug ===");
    console.log("Node data:", node);
    console.log("Node sae_indices (original):", node.sae_indices);
    console.log("Node sae_indices type:", typeof node.sae_indices[0]);
    
    // Clear concept search results first
    if (conceptSearchResults) {
      console.log("Clearing concept search results for BallMapper node click");
      setHighlightedSAEIndices([]);
      setSelectedSAEs([]);
      setNearestNeighborIndices([]);
      setNearestSAEsData({});
    }
    
    // Convert to strings to match UMAP format
    const saeIndices = node.sae_indices.map(String);
    console.log("Converted sae_indices to strings:", saeIndices);
    console.log("Layer details saes length:", layerDetails.saes.length);
    console.log("First few layer SAE indices:", layerDetails.saes.slice(0, 5).map(s => ({ index: s.index, type: typeof s.index })));
    
    // Convert node indices to strings for comparison with layer data
    const nodeSAEIndicesAsStrings = node.sae_indices.map(String);
    const filteredSAEs = layerDetails.saes.filter(sae => nodeSAEIndicesAsStrings.includes(String(sae.index)));
    console.log("Filtered SAEs for node:", filteredSAEs.length);
    console.log("Filtered SAE indices:", filteredSAEs.map(s => s.index));
    
    console.log("Setting highlightedSAEIndices to:", saeIndices);
    setHighlightedSAEIndices(saeIndices);
    setSelectedSAEs(filteredSAEs);
    setSelectedBallMapperNodeId(node.id);
    setSelectedBallMapperEdge(null); // Clear edge selection when node is clicked
    setNearestNeighborIndices([]); // Clear nearest neighbor highlighting
    setLassoSelectedSAEs([]); // Clear lasso selection
    
    // Fetch nearest SAEs for each SAE in the node
    for (const saeIndex of node.sae_indices) {
      const nearestSAEs = await fetchNearestSAEs(saeIndex);
      if (nearestSAEs) {
        setNearestSAEsData(prev => ({
          ...prev,
          [saeIndex]: nearestSAEs
        }));
      }
    }
  };

  // Callback for BallMapper edge selection
  const handleBallMapperEdgeClick = async (edge) => {
    // Clear concept search results first
    if (conceptSearchResults) {
      console.log("Clearing concept search results for BallMapper edge click");
      setHighlightedSAEIndices([]);
      setSelectedSAEs([]);
      setNearestNeighborIndices([]);
      setNearestSAEsData({});
    }
    
    // Highlight the SAEs that are common between the two connected nodes
    const commonSAEIndices = edge.common_saes.map(String); // Convert to strings to match UMAP
    console.log("BallMapper clicked edge:", edge.source, "->", edge.target);
    console.log("Common SAE indices:", commonSAEIndices);
    console.log("Edge common_saes:", edge.common_saes);
    console.log("Available SAE indices in layerDetails:", layerDetails.saes.map(s => s.index).slice(0, 10));
    
    // Convert edge common_saes to strings for comparison with layer data
    const edgeCommonSAEsAsStrings = edge.common_saes.map(String);
    const filteredSAEs = layerDetails.saes.filter(sae => edgeCommonSAEsAsStrings.includes(String(sae.index)));
    console.log("Filtered SAEs for edge:", filteredSAEs.length);
    console.log("Filtered SAE indices:", filteredSAEs.map(s => s.index));
    
    setHighlightedSAEIndices(commonSAEIndices);
    setSelectedSAEs(filteredSAEs);
    setSelectedBallMapperNodeId(null); // Clear node selection when edge is clicked
    setSelectedBallMapperEdge(edge);
    setNearestNeighborIndices([]); // Clear nearest neighbor highlighting
    setLassoSelectedSAEs([]); // Clear lasso selection
    
    // Fetch nearest SAEs for each SAE in the edge
    for (const saeIndex of edge.common_saes) {
      const nearestSAEs = await fetchNearestSAEs(saeIndex);
      if (nearestSAEs) {
        setNearestSAEsData(prev => ({
          ...prev,
          [saeIndex]: nearestSAEs
        }));
      }
    }
  };

  // Callback for LASSO selection
  const handleLassoSelection = (selectedSAEs) => {
    console.log("LASSO selected SAEs:", selectedSAEs.length);
    
    // Clear concept search results first
    if (conceptSearchResults) {
      console.log("Clearing concept search results for LASSO selection");
      setHighlightedSAEIndices([]);
      setSelectedSAEs([]);
      setNearestNeighborIndices([]);
      setNearestSAEsData({});
    }
    
    setLassoSelectedSAEs(selectedSAEs);
    setSelectedSAEs(selectedSAEs);
    setHighlightedSAEIndices(selectedSAEs.map(sae => String(sae.index)));
    setSelectedBallMapperNodeId(null); // Clear BallMapper selection
    setSelectedBallMapperEdge(null); // Clear BallMapper selection
    setNearestNeighborIndices([]); // Clear nearest neighbor highlighting
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 0.25, overflow: 'hidden', position: 'relative' }}>
      {/* Loading Overlay */}
      <Modal open={isLoading} sx={{ zIndex: 1000 }}>
        <ModalDialog
          sx={{
            backgroundColor: 'rgba(255, 255, 255, 0.98)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 3,
            p: 5,
            borderRadius: 3,
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            '@keyframes pulse': {
              '0%, 100%': { opacity: 1 },
              '50%': { opacity: 0.7 }
            },
            '@keyframes spin': {
              '0%': { transform: 'rotate(0deg)' },
              '100%': { transform: 'rotate(360deg)' }
            }
          }}
        >
          {/* Modern Loading Spinner */}
          <Box sx={{ position: 'relative', width: 80, height: 80 }}>
            <Box sx={{ 
              position: 'absolute',
              width: '100%',
              height: '100%',
              border: '3px solid #f0f0f0',
              borderRadius: '50%'
            }} />
            <Box sx={{ 
              position: 'absolute',
              width: '100%',
              height: '100%',
              border: '3px solid transparent',
              borderTop: '3px solid #1976d2',
              borderRight: '3px solid #1976d2',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }} />
          </Box>
          
          <Typography level="h5" color="primary" sx={{ fontWeight: 600 }}>
            Loading Layer {targetLayer}...
          </Typography>
          <Typography level="body-md" color="neutral.500" sx={{ textAlign: 'center' }}>
            Computing UMAP and BallMapper visualizations
          </Typography>
        </ModalDialog>
      </Modal>

      {/* Visualization Area */}
      <Box sx={{ display: 'flex', height: '75%', gap: 0.25, mb: 0.25 }}>
        {/* UMAP Visualization */}
        <Card sx={{ flex: 1, p: 0.5, pb: 0.25 }}>
          <CardContent sx={{ p: 0.5, pb: 0.25, height: '100%' }}>
            <UMAPVisualization 
              layerDetails={layerDetails}
              selectedCategory={selectedCategory}
              onPointClick={handleUMAPPointClick}
              highlightedIndices={highlightedSAEIndices}
              nearestNeighborIndices={nearestNeighborIndices}
              onLassoSelection={handleLassoSelection}
              conceptSearchResults={conceptSearchResults}
              pinnedCategory={pinnedCategory}
              comparisonCategory={comparisonCategory}
              currentThreshold={currentThreshold}
              currentConceptDataset={currentConceptDataset}
              onLoaded={handleUmapLoaded}
            />
          </CardContent>
        </Card>

        {/* Ball Mapper Visualization */}
        <Card sx={{ flex: 1, p: 0.5, pb: 0.25 }}>
          <CardContent sx={{ p: 0.5, pb: 0.25, height: '100%' }}>
            <BallMapperVisualization 
              layerDetails={layerDetails}
              selectedCategory={selectedCategory}
              onNodeClick={handleBallMapperNodeClick}
              onEdgeClick={handleBallMapperEdgeClick}
              highlightedSAEIndices={highlightedSAEIndices}
              selectedNodeId={selectedBallMapperNodeId}
              selectedEdge={selectedBallMapperEdge}
              conceptSearchResults={conceptSearchResults}
              pinnedCategory={pinnedCategory}
              comparisonCategory={comparisonCategory}
              currentThreshold={currentThreshold}
              currentConceptDataset={currentConceptDataset}
              onLoaded={handleBallMapperLoaded}
            />
          </CardContent>
        </Card>
      </Box>

      {/* SAE Details */}
      <Box sx={{ flex: 1, overflow: 'hidden', p: 0.25, height: '100%' }}>
          {selectedSAEs.length > 0 ? (
            // Show selected SAEs with horizontal scrolling
            <Box sx={{ 
              height: '100%', 
              overflow: 'auto',
              display: 'flex',
              gap: 1,
              pb: 1 // Add padding bottom to prevent truncation
            }}>
              {selectedSAEs.map((sae, index) => (
                <Card 
                  key={`${sae.layer}-${sae.index}`} 
                  variant="outlined" 
                  size="sm"
                  sx={{ 
                    minWidth: 400, 
                    maxWidth: 450,
                    flexShrink: 0 // Prevent cards from shrinking
                  }}
                >
                  <CardContent sx={{ p: 1.5, height: '100%', overflow: 'auto' }}>
                    <Typography 
                      level="body-sm" 
                      sx={{ 
                        mb: 1, 
                        wordBreak: 'break-word',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        '&:hover': {
                          color: 'primary.500'
                        }
                      }}
                      onClick={() => {
                        window.open(`https://www.neuronpedia.org/gemma-2-2b/${sae.layer}-gemmascope-res-65k/${sae.index}`, '_blank');
                      }}
                    >
                      {sae.explanation || "No explanation available"}
                    </Typography>
                    
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Typography level="body-sm" sx={{ fontWeight: 'bold', minWidth: 'fit-content' }}>
                        Concepts:
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {sae.concept.map((concept, idx) => (
                          <Chip 
                            key={idx} 
                            size="sm" 
                            variant="soft"
                            color="primary"
                          >
                            {concept}
                          </Chip>
                        ))}
                      </Box>
                    </Box>
                    
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Typography level="body-sm" sx={{ fontWeight: 'bold', minWidth: 'fit-content' }}>
                        Categories:
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {sae.all_categories.map((category, idx) => (
                          <Chip 
                            key={idx} 
                            size="sm" 
                            variant="outlined"
                            color="neutral"
                          >
                            {category}
                          </Chip>
                        ))}
                      </Box>
                    </Box>
                    
                    <Typography level="body-sm" sx={{ mb: 1 }}>
                      <strong>Nearest features cosine similarity:</strong>
                    </Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1 }}>
                      {nearestSAEsData[sae.index] ? nearestSAEsData[sae.index].map((nearestSAE, idx) => (
                        <Box key={idx} sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                          <Typography 
                            level="body-xs" 
                            sx={{ 
                              fontStyle: 'italic', 
                              wordBreak: 'break-word',
                              cursor: 'pointer',
                              textDecoration: 'underline',
                              '&:hover': {
                                color: 'primary.500'
                              }
                            }}
                            onClick={() => {
                              window.open(`https://www.neuronpedia.org/gemma-2-2b/${sae.layer}-gemmascope-res-65k/${nearestSAE.index}`, '_blank');
                            }}
                          >
                            {nearestSAE.explanation || "No explanation available"} ({nearestSAE.similarity.toFixed(3)})
                          </Typography>
                        </Box>
                      )) : (
                        <Typography level="body-xs" color="neutral">
                          No nearest features available
                        </Typography>
                      )}
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Box>
          ) : (
            // Show placeholder when no SAEs selected
            <Box sx={{ 
              height: '100%', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center' 
            }}>
              <Typography level="body-sm" color="neutral">
                Select a point in UMAP or a node/edge in BallMapper to view feature details
              </Typography>
            </Box>
          )}
        </Box>
    </Box>
  );
};

export default VisualizationArea;
