import React, { useState, useEffect } from 'react';
import {
  Box,
  Select,
  Option,
  Slider,
  Button,
  Typography,
  FormControl,
  CircularProgress,
  Tooltip,
  IconButton
} from '@mui/joy';
import InfoIcon from '@mui/icons-material/Info';

const DataLoader = ({ onDataLoaded, onThresholdChange }) => {
  const [datasets, setDatasets] = useState([]);
  const [conceptDatasets, setConceptDatasets] = useState([]);
  const [selectedDataset, setSelectedDataset] = useState('');
  const [selectedConceptDataset, setSelectedConceptDataset] = useState('');
  const [threshold, setThreshold] = useState(0.5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Call onThresholdChange when threshold changes
  useEffect(() => {
    if (onThresholdChange) {
      onThresholdChange(threshold);
    }
  }, [threshold, onThresholdChange]);

  useEffect(() => {
    // Load available datasets
    fetch('http://localhost:5001/api/datasets')
      .then(response => response.json())
      .then(data => {
        setDatasets(data);
        if (data.length > 0) {
          setSelectedDataset(data[0].id);
        }
      })
      .catch(error => {
        console.error('Error loading datasets:', error);
        setError('Failed to load datasets');
      });

    // Load available concept datasets
    fetch('http://localhost:5001/api/concept-datasets')
      .then(response => response.json())
      .then(data => {
        setConceptDatasets(data);
        if (data.length > 0) {
          setSelectedConceptDataset(data[0].id);
        }
      })
      .catch(error => {
        console.error('Error loading concept datasets:', error);
        setError('Failed to load concept datasets');
      });
  }, []);

  const handleLoadData = async () => {
    if (!selectedDataset || !selectedConceptDataset) {
      setError('Please select both dataset and concept dataset');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('http://localhost:5001/api/load-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dataset_id: selectedDataset,
          concept_dataset_id: selectedConceptDataset,
          threshold: threshold
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      onDataLoaded(data);
    } catch (error) {
      console.error('Error loading data:', error);
      setError('Failed to load data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, height: '100%', overflow: 'visible', justifyContent: 'center' }}>
      {/* First Row: Dataset and Concept Dataset */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5 }}>
        {/* Dataset Selection */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography level="body-xs" sx={{ fontSize: '0.75rem' }}>
            SAE Features:
          </Typography>
          <FormControl size="sm" sx={{ minWidth: 120 }}>
            <Select
              value={selectedDataset}
              onChange={(event, newValue) => setSelectedDataset(newValue)}
              disabled={loading}
            >
              {datasets.map((dataset) => (
                <Option key={dataset.id} value={dataset.id}>
                  {dataset.name}
                </Option>
              ))}
            </Select>
          </FormControl>
        </Box>

        {/* Concept Dataset Selection */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography level="body-xs" sx={{ fontSize: '0.75rem' }}>
            Concept:
          </Typography>
          <FormControl size="sm" sx={{ minWidth: 120 }}>
            <Select
              value={selectedConceptDataset}
              onChange={(event, newValue) => setSelectedConceptDataset(newValue)}
              disabled={loading}
            >
              {conceptDatasets.map((dataset) => (
                <Option key={dataset.id} value={dataset.id}>
                  {dataset.name}
                </Option>
              ))}
            </Select>
          </FormControl>
        </Box>
      </Box>

      {/* Second Row: Threshold and Load Button */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 0.5 }}>
        {/* Threshold Slider */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography level="body-xs" sx={{ fontSize: '0.75rem' }}>
            Threshold:
          </Typography>
          <Tooltip title="Cosine similarity between the concept words and feature explanations" placement="top">
            <IconButton size="sm" sx={{ p: 0.25 }}>
              <InfoIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Box sx={{ width: 150, px: 0.5 }}>
            <Slider
              value={threshold}
              onChange={(event, newValue) => setThreshold(newValue)}
              min={0.4}
              max={0.9}
              step={0.01}
              disabled={loading}
              valueLabelDisplay="auto"
              size="sm"
            />
          </Box>
          <Typography level="body-xs" sx={{ minWidth: 25, fontSize: '0.75rem' }}>
            {threshold}
          </Typography>
        </Box>

        {/* Load Button */}
        <Button
          onClick={handleLoadData}
          disabled={loading || !selectedDataset || !selectedConceptDataset}
          startDecorator={loading ? <CircularProgress size="sm" /> : null}
          size="sm"
          sx={{ height: '28px', px: 2 }}
        >
          {loading ? 'Loading...' : 'Load Relevant Features'}
        </Button>
      </Box>

      {error && (
        <Typography color="danger" level="body-xs" sx={{ mt: 0.5 }}>
          {error}
        </Typography>
      )}
    </Box>
  );
};

export default DataLoader;
