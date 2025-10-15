import React, { useState } from 'react';
import { Box, Typography, CssVarsProvider } from '@mui/joy';
import DataLoader from './components/DataLoader';
import LayerSummary from './components/LayerSummary';
import VisualizationArea from './components/VisualizationArea';
import CategorySidebar from './components/CategorySidebar';
import './App.css';

function App() {
  const [dataLoaded, setDataLoaded] = useState(false);
  const [layerData, setLayerData] = useState(null);
  const [selectedLayer, setSelectedLayer] = useState(null);
  const [layerDetails, setLayerDetails] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [conceptSearchResults, setConceptSearchResults] = useState(null);
  const [pinnedCategory, setPinnedCategory] = useState(null);
  const [comparisonCategory, setComparisonCategory] = useState(null);
  const [currentThreshold, setCurrentThreshold] = useState(0.5);
  const [currentConceptDataset, setCurrentConceptDataset] = useState('thingsplus');

  const handleDataLoaded = (data) => {
    setLayerData(data);
    setDataLoaded(true);
    setCurrentConceptDataset(data.concept_dataset_id || 'thingsplus');
    
    // Clear current layer selection when dataset changes
    setSelectedLayer(null);
    setLayerDetails(null);
    setSelectedCategory(null);
    setConceptSearchResults(null);
    setPinnedCategory(null);
    setComparisonCategory(null);
  };

  const handleThresholdChange = (threshold) => {
    setCurrentThreshold(threshold);
  };

  const handleLayerSelect = async (layer) => {
    console.log('Selecting layer:', layer, 'with threshold:', currentThreshold, 'concept dataset:', currentConceptDataset);
    setSelectedLayer(layer);
    
    // Clear concept search results and category selections when switching layers
    setConceptSearchResults(null);
    setSelectedCategory(null);
    setPinnedCategory(null);
    setComparisonCategory(null);
    
    try {
      const response = await fetch(`http://127.0.0.1:5001/api/layer-data/${layer}?threshold=${currentThreshold}&concept_dataset_id=${currentConceptDataset}`);
      console.log('Response status:', response.status);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Layer data loaded:', data);
      setLayerDetails(data);
    } catch (error) {
      console.error('Error loading layer details:', error);
      // Set a placeholder to show that there was an error
      setLayerDetails({ error: error.message });
    }
  };

  const handleCategorySelect = (category) => {
    console.log('Category selection:', category === null ? 'deselecting all' : `selecting ${category}`);
    
    if (pinnedCategory) {
      // In comparison mode: pinned category exists
      if (category === null) {
        // Deselecting comparison category - keep pinned category selected
        setSelectedCategory(pinnedCategory);
        setComparisonCategory(null);
      } else if (category === pinnedCategory) {
        // Clicking on pinned category - deselect it (unpin)
        setSelectedCategory(null);
        setPinnedCategory(null);
        setComparisonCategory(null);
      } else {
        // Clicking on a different category - set as comparison category
        setSelectedCategory(category);
        setComparisonCategory(category);
      }
    } else {
      // Normal mode: no pinned category
      setSelectedCategory(category);
      setComparisonCategory(null);
    }
  };

  const handleConceptSelect = (concept, matchingSaeIndices) => {
    console.log('Concept selection:', concept, 'with', matchingSaeIndices?.length, 'matching SAEs');
    // Clear category selection when concept is selected (global query)
    setSelectedCategory(null);
    // Store concept search results
    setConceptSearchResults(matchingSaeIndices ? { concept, matchingSaeIndices } : null);
  };

  const handlePinCategory = (category) => {
    console.log('Pin category:', category === null ? 'unpinning' : `pinning ${category}`);
    
    if (category === null) {
      // Unpinning - clear all comparison state
      setPinnedCategory(null);
      setComparisonCategory(null);
      setSelectedCategory(null);
    } else {
      // Pinning - set as pinned category and selected category
      setPinnedCategory(category);
      setSelectedCategory(category);
      setComparisonCategory(null); // Clear any previous comparison
    }
  };

  return (
    <CssVarsProvider>
      <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', px: 2, overflow: 'hidden' }}>
        {/* Upper Part */}
        <Box sx={{ 
          display: 'flex', 
          height: '120px', 
          borderBottom: '1px solid',
          borderColor: 'divider',
          gap: 1,
          alignItems: 'center'
        }}>
          {/* Logo */}
          <Box sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            width: '120px',
            height: '100%',
            p: 1,
            paddingRight: "20px"
          }}>
            <img 
              src="/logo.png" 
              alt="SAE Semantic Explorer" 
              style={{ 
                maxWidth: '90%', 
                maxHeight: '80%',
                objectFit: 'contain'
              }}
            />
          </Box>
          
          {/* Data Loader */}
          <Box sx={{ width: '530px', p: 1, overflow: 'visible' }}>
            <DataLoader onDataLoaded={handleDataLoaded} onThresholdChange={handleThresholdChange} />
          </Box>
          
          {/* Layer Summary */}
          <Box sx={{ flex: 1, p: 1, overflow: 'hidden' }}>
            {dataLoaded && (
              <LayerSummary 
                layerData={layerData} 
                onLayerSelect={handleLayerSelect}
                selectedLayer={selectedLayer}
              />
            )}
          </Box>
        </Box>
        
        {/* Lower Part */}
        {dataLoaded && selectedLayer !== null && (
          <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {/* Category Sidebar */}
            <Box sx={{ width: '250px', borderRight: '1px solid', borderColor: 'divider', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {layerDetails && !layerDetails.error && (
                <CategorySidebar 
                  categoryDistribution={layerDetails.category_distribution}
                  onCategorySelect={handleCategorySelect}
                  selectedCategory={selectedCategory}
                  currentLayer={selectedLayer}
                  onConceptSelect={handleConceptSelect}
                  conceptSearchResults={conceptSearchResults}
                  pinnedCategory={pinnedCategory}
                  onPinCategory={handlePinCategory}
                  comparisonCategory={comparisonCategory}
                  currentThreshold={currentThreshold}
                  currentConceptDataset={currentConceptDataset}
                />
              )}
            </Box>
            
            {/* Main Visualization Area */}
            <Box sx={{ flex: 1, overflow: 'hidden' }}>
              {layerDetails && layerDetails.error ? (
                <Box sx={{ p: 3, textAlign: 'center' }}>
                  <Typography color="danger" level="h6">
                    Error loading layer data: {layerDetails.error}
                  </Typography>
                </Box>
              ) : (
                <VisualizationArea 
                  layerDetails={layerDetails}
                  selectedCategory={selectedCategory}
                  currentLayer={selectedLayer}
                  conceptSearchResults={conceptSearchResults}
                  pinnedCategory={pinnedCategory}
                  comparisonCategory={comparisonCategory}
                  currentThreshold={currentThreshold}
                  currentConceptDataset={currentConceptDataset}
                />
              )}
            </Box>
          </Box>
        )}
      </Box>
    </CssVarsProvider>
  );
}

export default App;
