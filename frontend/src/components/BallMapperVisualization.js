import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Box, Typography, Slider, IconButton, Tooltip, Modal, ModalDialog, DialogTitle, DialogContent, Divider, Button, Switch } from '@mui/joy';
import TuneIcon from '@mui/icons-material/Tune';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import * as d3 from 'd3';

const BallMapperVisualization = ({ layerDetails, selectedCategory, onNodeClick, onEdgeClick, highlightedSAEIndices = [], selectedNodeId = null, selectedEdge = null, conceptSearchResults, pinnedCategory, comparisonCategory, currentThreshold, currentConceptDataset, onLoaded }) => {
  const svgRef = useRef();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  // Remove local selectedNode state - use selectedNodeId prop instead
  const [layoutMix, setLayoutMix] = useState(0.5); // 0 = anchored, 1 = force-directed
  const [epsilon, setEpsilon] = useState(null); // Custom epsilon value
  const [computedEpsilon, setComputedEpsilon] = useState(null); // Backend computed epsilon
  const [useCustomEpsilon, setUseCustomEpsilon] = useState(false); // Whether to use custom epsilon
  const [paramsOpen, setParamsOpen] = useState(false);
  const [draftEpsilon, setDraftEpsilon] = useState(null); // Uncommitted epsilon in modal
  const [draftUseCustomEpsilon, setDraftUseCustomEpsilon] = useState(false); // Uncommitted mode in modal
  const [maxSize, setMaxSize] = useState(5); // live max_size parameter
  const [draftMaxSize, setDraftMaxSize] = useState(5); // uncommitted max_size in modal

  const abortControllerRef = useRef(null);
  const timeoutRef = useRef(null);

  // Check if we're in comparison mode
  const isComparisonMode = pinnedCategory && comparisonCategory && pinnedCategory !== comparisonCategory;

  // Calculate pie chart data for each node in comparison mode
  const calculatePieChartData = useCallback((node) => {
    if (!isComparisonMode || !pinnedCategory || !comparisonCategory || !layerDetails) {
      return null; // No pie chart in normal mode
    }

    const nodeSAEs = node.sae_indices || [];
    let pinnedOnly = 0;
    let comparisonOnly = 0;
    let shared = 0;

    nodeSAEs.forEach(saeIndex => {
      // Find the SAE data for this index
      const sae = layerDetails.saes.find(s => 
        s.index === saeIndex || 
        String(s.index) === String(saeIndex) || 
        Number(s.index) === Number(saeIndex)
      );
      
      if (sae && sae.all_categories) {
        const hasPinned = sae.all_categories.includes(pinnedCategory);
        const hasComparison = sae.all_categories.includes(comparisonCategory);
        
        if (hasPinned && hasComparison) {
          shared++;
        } else if (hasPinned) {
          pinnedOnly++;
        } else if (hasComparison) {
          comparisonOnly++;
        }
      }
    });

    // Only return pie chart data if we have meaningful distribution
    if (pinnedOnly + comparisonOnly + shared > 0) {
      return [
        { type: 'pinned', count: pinnedOnly, color: '#1976D2' },
        { type: 'comparison', count: comparisonOnly, color: '#D32F2F' },
        { type: 'shared', count: shared, color: '#9C27B0' }
      ].filter(segment => segment.count > 0); // Only include segments with SAEs
    }
    
    return null;
  }, [isComparisonMode, pinnedCategory, comparisonCategory, layerDetails]);

  const fetchBallMapperData = useCallback(async () => {
    if (!layerDetails) return;
    
    console.log(`Fetching BallMapper data for layer ${layerDetails.layer}, category: ${selectedCategory}, comparison mode: ${isComparisonMode}`);
    
    // Cancel any ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    // Create new abort controller for this request
    abortControllerRef.current = new AbortController();
    
    try {
      setLoading(true);
      
      // Build query parameters
      const params = new URLSearchParams();
      params.append('threshold', currentThreshold.toString());
      params.append('concept_dataset_id', currentConceptDataset);
      params.append('max_size', String(maxSize));
      
      // Add custom epsilon if enabled
      if (useCustomEpsilon && epsilon !== null) {
        params.append('epsilon', epsilon.toString());
      }
      if (isComparisonMode) {
        // In comparison mode, filter by both pinned and comparison categories
        const categories = [pinnedCategory, comparisonCategory];
        params.append('categories', JSON.stringify(categories));
        console.log(`Comparison mode: filtering BallMapper by categories: ${categories}`);
      } else if (selectedCategory) {
        // In normal mode, filter by selected category
        params.append('category', selectedCategory);
        console.log(`Normal mode: filtering BallMapper by category: ${selectedCategory}`);
      }
      // Note: We don't pass concept to BallMapper - it should show all nodes
      // and we'll highlight the ones containing concept search results
      
      const response = await fetch(`http://127.0.0.1:5001/api/layer/${layerDetails.layer}/ballmapper?${params.toString()}`, {
        signal: abortControllerRef.current.signal
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.error) {
        console.error('BallMapper error:', result.error);
        setData({ error: result.error });
      } else {
        console.log('BallMapper data received:', {
          nodes: result.nodes.length,
          edges: result.edges.length,
          sampleNode: result.nodes[0] ? {
            id: result.nodes[0].id,
            sae_count: result.nodes[0].sae_count,
            sae_indices: result.nodes[0].sae_indices ? result.nodes[0].sae_indices.slice(0, 5) : null
          } : null,
          allSaeIndices: result.nodes.flatMap(node => node.sae_indices || []).slice(0, 10)
        });
        setData(result);
        
        // Store computed epsilon if provided
        if (result.computed_epsilon !== undefined) {
          setComputedEpsilon(result.computed_epsilon);
          // Set epsilon value to computed value if in Auto mode or if epsilon is not set
          if (!useCustomEpsilon || epsilon === null) {
            setEpsilon(result.computed_epsilon);
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        // Request was cancelled, don't set error
        return;
      }
      console.error('Error fetching BallMapper data:', err);
    } finally {
      setLoading(false);
    }
  }, [layerDetails, selectedCategory, pinnedCategory, comparisonCategory, isComparisonMode, useCustomEpsilon, epsilon, maxSize]);

  useEffect(() => {
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    if (layerDetails) {
      // Add a small delay to prevent rapid successive requests
      timeoutRef.current = setTimeout(() => {
        fetchBallMapperData();
      }, 100);
    }
    
    // Cleanup function to cancel any pending requests and timeouts
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [layerDetails, selectedCategory, fetchBallMapperData, currentConceptDataset]);

  const createBallMapperVisualization = useCallback(() => {
    if (!data || !svgRef.current) return;
    
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    
    // Remove any existing tooltips
    d3.selectAll(".ballmapper-tooltip").remove();

    // Get SVG dimensions
    const svgElement = svgRef.current;
    const rect = svgElement.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    


    // Create SVG group for zoomable content
    const g = svg.append("g");

    // Add zoom behavior
    const zoom = d3.zoom()
      .scaleExtent([0.1, 10])
      .on("zoom", (event) => {
        // Apply zoom transform directly to the group
        g.attr("transform", event.transform);
      });

    // Apply zoom to SVG
    svg.call(zoom);
    
    // Set initial transform to center the view at (0,0)
    const initialTransform = d3.zoomIdentity.translate(width / 2, height / 2);
    svg.call(zoom.transform, initialTransform);

    // Calculate anchored positions (average UMAP coordinates for each node)
    const calculateAnchoredPositions = () => {
    const anchoredPositions = {};
    
          // Check if we have UMAP data from layerDetails
      if (!layerDetails || !layerDetails.saes) {
        return {};
      }
      
      // Filter layerDetails by selected category or comparison categories if needed
      let relevantSAEs = layerDetails.saes;
      if (isComparisonMode && pinnedCategory && comparisonCategory) {
        // In comparison mode, use SAEs from both pinned and comparison categories
        relevantSAEs = layerDetails.saes.filter(sae => 
          sae.all_categories && 
          (sae.all_categories.includes(pinnedCategory) || sae.all_categories.includes(comparisonCategory))
        );
      } else if (selectedCategory) {
        // In normal mode, use SAEs from selected category
        relevantSAEs = layerDetails.saes.filter(sae => sae.all_categories && sae.all_categories.includes(selectedCategory));
      }
      
      // Get UMAP coordinate bounds from relevant SAEs
      const allUmapCoords = relevantSAEs
        .filter(sae => sae.umap_coordinates && Array.isArray(sae.umap_coordinates) && sae.umap_coordinates.length >= 2)
        .map(sae => sae.umap_coordinates);
            
      if (allUmapCoords.length === 0) {
        return {};
      }
      
      const xExtent = d3.extent(allUmapCoords, d => d[0]);
      const yExtent = d3.extent(allUmapCoords, d => d[1]);
      
            data.nodes.forEach(node => {
        if (node.sae_indices && node.sae_indices.length > 0) {
          // Get UMAP coordinates for SAEs in this node from layerDetails
          const nodeUmapCoords = [];
          
          node.sae_indices.forEach(saeIndex => {
            // Try both exact match and string conversion
            let sae = relevantSAEs.find(s => s.index === saeIndex);
            if (!sae) {
              // Try string conversion
              sae = relevantSAEs.find(s => String(s.index) === String(saeIndex));
            }
            if (!sae) {
              // Try number conversion
              sae = relevantSAEs.find(s => Number(s.index) === Number(saeIndex));
            }
            if (sae && sae.umap_coordinates && Array.isArray(sae.umap_coordinates) && sae.umap_coordinates.length >= 2) {
              nodeUmapCoords.push(sae.umap_coordinates);
            }
          });
          

          if (nodeUmapCoords.length > 0) {
            const avgX = nodeUmapCoords.reduce((sum, coord) => sum + coord[0], 0) / nodeUmapCoords.length;
            const avgY = nodeUmapCoords.reduce((sum, coord) => sum + coord[1], 0) / nodeUmapCoords.length;
            
            // Use the same coordinate system as UMAP: range([0, width]) and range([height, 0])
            // This means (0,0) is at top-left, (width,height) is at bottom-right
            const scaledX = (avgX - xExtent[0]) / (xExtent[1] - xExtent[0]) * width;
            const scaledY = (avgY - yExtent[0]) / (yExtent[1] - yExtent[0]) * height;
            
            // Convert to BallMapper's centered coordinate system (0,0 at center)
            const ballMapperX = scaledX - width/2;
            const ballMapperY = -(scaledY - height/2); // Invert Y to match UMAP's range([height, 0])
            
            anchoredPositions[node.id] = { 
              x: ballMapperX, 
              y: ballMapperY
            };
            

          }
        }
      });
      
                return anchoredPositions;
  };

  const anchoredPositions = calculateAnchoredPositions();

  // Create hybrid force simulation
    let simulation;
    
    
    
    if (layoutMix <= 0.01) { // Use small tolerance for "fully anchored"
      // Fully anchored: directly set positions, no forces
      
              data.nodes.forEach((node, index) => {
          const anchor = anchoredPositions[node.id];
          if (anchor) {
            node.x = anchor.x;
            node.y = anchor.y;
            node.fx = anchor.x; // Fix position
            node.fy = anchor.y;
          } else {
            // Fallback: spread nodes in a circle to avoid overlap
            const angle = (index / data.nodes.length) * 2 * Math.PI;
            const radius = 50;
            const fallbackX = Math.cos(angle) * radius;
            const fallbackY = Math.sin(angle) * radius;
            node.x = fallbackX;
            node.y = fallbackY;
            node.fx = fallbackX;
            node.fy = fallbackY;
          }
        });
      
      // Create minimal simulation just for rendering
      simulation = d3.forceSimulation(data.nodes)
        .force("link", d3.forceLink(data.edges).id(d => d.id).strength(0))
        .force("charge", d3.forceManyBody().strength(0))
        .force("x", d3.forceX(0).strength(0))
        .force("y", d3.forceY(0).strength(0));
        
    } else {
      // Hybrid or force-directed: use forces
      // Clear fixed positions for all nodes when switching to force-directed
      data.nodes.forEach(node => {
        node.fx = null;
        node.fy = null;
      });
      
      // Scale forces based on layout mix
      const linkStrength = 0.2 + (layoutMix * 0.6); // 0.2 to 0.8
      const chargeStrength = -50 + (layoutMix * -100); // -50 to -150
      const anchorStrength = Math.pow(1 - layoutMix, 2) * 0.80+0.05; // 0.8 to 0
      
      // Add centering forces that become stronger as layout mix increases
      const centerStrength = layoutMix * 0.15; // 0 to 0.1 (weak to moderate)
      
      simulation = d3.forceSimulation(data.nodes)
        .force("link", d3.forceLink(data.edges).id(d => d.id).strength(linkStrength))
        .force("charge", d3.forceManyBody().strength(chargeStrength))
        .force("x", d3.forceX().x(d => {
          const anchor = anchoredPositions[d.id];
          return anchor ? anchor.x : 0;
        }).strength(anchorStrength))
        .force("y", d3.forceY().y(d => {
          const anchor = anchoredPositions[d.id];
          return anchor ? anchor.y : 0;
        }).strength(anchorStrength))
        .force("centerX", d3.forceX(0).strength(centerStrength)) // Add X centering force
        .force("centerY", d3.forceY(0).strength(centerStrength)); // Add Y centering force
    }

    // Create links
    const links = g.append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(data.edges)
      .enter()
      .append("line")
      .attr("stroke", "#999")
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", 2)
      .style("cursor", "pointer")
      .on("click", function(event, d) {
        if (onEdgeClick) {
          onEdgeClick(d);
        }
      });

    // Create node groups (each containing a circle and label)
    const nodeGroups = g.append("g")
      .attr("class", "nodes")
      .selectAll("g")
      .data(data.nodes)
      .enter()
      .append("g")
      .attr("class", "node-group")
      .call(d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended));

    // Add nodes to each group (circles or pie charts)
    nodeGroups.each(function(d) {
      const nodeGroup = d3.select(this);
      const nodeRadius = 7 + Math.sqrt(d.sae_count);
      
      // Check if we should show pie chart (comparison mode)
      const pieData = calculatePieChartData(d);
      
      if (isComparisonMode && pieData && pieData.length > 1) {
        // Create pie chart for mixed nodes in comparison mode
        const pie = d3.pie()
          .value(segment => segment.count)
          .sort(null);
        
        const arc = d3.arc()
          .innerRadius(0)
          .outerRadius(nodeRadius);
        
        // Create pie chart segments
        const pieGroup = nodeGroup.append("g")
          .attr("class", "pie-chart");
        
        pieGroup.selectAll("path")
          .data(pie(pieData))
          .enter()
          .append("path")
          .attr("d", arc)
          .attr("fill", d => d.data.color)
          .attr("opacity", 0.8)
          .attr("stroke", "#ffffff")
          .attr("stroke-width", 1);
      } else {
        // Create regular circle
        let fillColor = "#666666"; // Default neutral gray color for normal mode
        
        // In comparison mode, determine the color based on node content
        if (isComparisonMode && pieData && pieData.length === 1) {
          // Single category node - use the category color
          fillColor = pieData[0].color;
        }
        
        nodeGroup.append("circle")
          .attr("r", nodeRadius)
          .attr("fill", fillColor)
          .attr("opacity", 0.8)
          .attr("stroke", "#ffffff")
          .attr("stroke-width", 2);
      }
    });

    // Add labels to each group
    nodeGroups.append("text")
      .text(d => d.sae_count)
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("font-size", "12px")
      .attr("font-weight", "bold")
      .attr("fill", "#ffffff");

    // Add hover effects and click interaction
    nodeGroups
      .on("mouseover", function(event, d) {
        // Increase opacity on hover
        const nodeGroup = d3.select(this);
        const hasPieChart = nodeGroup.select(".pie-chart").size() > 0;
        const hasCircle = nodeGroup.select("circle").size() > 0;
        
        if (hasPieChart) {
          nodeGroup.select(".pie-chart").selectAll("path").attr("opacity", 0.9);
        } else if (hasCircle) {
          nodeGroup.select("circle").attr("opacity", 0.9);
        }
      })
      .on("mouseout", function(event, d) {
        // Restore original opacity on mouse out
        const nodeGroup = d3.select(this);
        const hasPieChart = nodeGroup.select(".pie-chart").size() > 0;
        const hasCircle = nodeGroup.select("circle").size() > 0;
        
        if (hasPieChart) {
          nodeGroup.select(".pie-chart").selectAll("path").attr("opacity", 0.8);
        } else if (hasCircle) {
          nodeGroup.select("circle").attr("opacity", 0.8);
        }
      })
      .on("click", function(event, d) {
        console.log("BallMapper node clicked:", d.id, "calling onNodeClick");
        if (onNodeClick) {
          onNodeClick(d);
        }
      });

    // Drag functions
    function dragstarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event, d) {
      // when the drag ends, we release the fixed position
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

    // Update positions on simulation tick
    simulation.on("tick", () => {
      links
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);

      // Update node group positions (this moves both circle and label together)
      nodeGroups
        .attr("transform", d => `translate(${d.x},${d.y})`);
      

    });

    // Cleanup function
    return () => {
      simulation.stop();
    };
  }, [data, layoutMix, onLoaded]);

  useEffect(() => {
    if (data && svgRef.current) {
      const cleanup = createBallMapperVisualization();
      
      // Call onLoaded callback when visualization is complete
      if (onLoaded) {
        // Use a small delay to ensure the visualization is fully rendered
        setTimeout(() => {
          onLoaded();
        }, 100);
      }
      
      return cleanup;
    }
  }, [data, layoutMix, createBallMapperVisualization, onLoaded]);

  // Update node styling based on selection and highlighting state
  useEffect(() => {
    if (!data || !svgRef.current) return;
    
    const timeoutId = setTimeout(() => {
      const svg = d3.select(svgRef.current);
      const nodeGroups = svg.selectAll(".nodes .node-group");
      
      nodeGroups.each(function() {
        const nodeGroup = d3.select(this);
        const nodeData = nodeGroup.datum();
        if (!nodeData) return;
        
        // Check if this node has a pie chart or circle
        const hasPieChart = nodeGroup.select(".pie-chart").size() > 0;
        const hasCircle = nodeGroup.select("circle").size() > 0;
        
        if (hasPieChart) {
          // Handle pie chart styling (comparison mode)
          const pieChart = nodeGroup.select(".pie-chart");
          let opacity = 0.8; // Default pie chart opacity
          let strokeColor = "#ffffff";
          let strokeWidth = 1;
          
          const isSelected = selectedNodeId === nodeData.id;
          // Only highlight from UMAP if no specific node is selected
          const isHighlightedFromUMAP = selectedNodeId === null && 
            highlightedSAEIndices.length > 0 && 
            nodeData.sae_indices && 
            highlightedSAEIndices.some(saeIndex => 
              nodeData.sae_indices.includes(Number(saeIndex))
            );
          // Remove concept search highlighting from BallMapper - only show UMAP selections
          if (isSelected) {
            opacity = 1.0; // Full opacity for selected nodes
            strokeColor = "#FF8C00"; // Orange border
            strokeWidth = 3;
          } else if (isHighlightedFromUMAP) {
            opacity = 1.0; // Full opacity for highlighted nodes
            strokeColor = "#FF8C00"; // Orange border
            strokeWidth = 3;
          }
          
          pieChart.selectAll("path")
            .attr("opacity", opacity)
            .attr("stroke", strokeColor)
            .attr("stroke-width", strokeWidth);
        } else if (hasCircle) {
          // Handle circle styling (normal mode)
          const circle = nodeGroup.select("circle");
          let fillColor = "#666666";
          let strokeColor = "#ffffff";
          let strokeWidth = 2;
          let opacity = 0.8; // Default opacity
          
          const isSelected = selectedNodeId === nodeData.id;
          // In comparison mode, preserve the category colors unless overridden by selection/highlighting
          if (isComparisonMode) {
            const pieData = calculatePieChartData(nodeData);
            if (pieData && pieData.length === 1) {
              fillColor = pieData[0].color; // Use category color for single-category nodes
            }
          }
          
          // Check if this node should be highlighted from UMAP/LASSO
          // Only highlight from UMAP if no specific node is selected
          const isHighlightedFromUMAP = selectedNodeId === null && 
            highlightedSAEIndices.length > 0 && 
            nodeData.sae_indices && 
            highlightedSAEIndices.some(saeIndex => 
              nodeData.sae_indices.includes(Number(saeIndex))
            );
          
          if (isSelected) {
            // Keep original fill color, only change border
            strokeColor = "#FF8C00"; // Orange border
            strokeWidth = 4;
            opacity = 1.0; // Full opacity for selected nodes
          } else if (isHighlightedFromUMAP) {
            // Keep original fill color, only change border for UMAP highlighting
            strokeColor = "#FF8C00"; // Orange border
            strokeWidth = 4;
            opacity = 1.0; // Full opacity for highlighted nodes
          }
          
          circle
            .attr("fill", fillColor)
            .attr("stroke", strokeColor)
            .attr("stroke-width", strokeWidth)
            .attr("opacity", opacity);
        }
      });
    }, 100);
    
    return () => clearTimeout(timeoutId);
  }, [selectedNodeId, selectedEdge, highlightedSAEIndices, data, comparisonCategory, isComparisonMode, layerDetails, onEdgeClick, onNodeClick, pinnedCategory, selectedCategory]);

  // Update node labels to show highlighted/total format
  useEffect(() => {
    if (!data || !svgRef.current) return;
    
    const timeoutId = setTimeout(() => {
      const svg = d3.select(svgRef.current);
      const labels = svg.selectAll(".nodes .node-group text");
      
      labels.each(function() {
        const label = d3.select(this);
        const nodeData = label.datum();
        if (!nodeData) return;
        
        let labelText = nodeData.sae_count; // Default to total count
        
        // If there are highlighted SAEs and no specific node is selected, show highlighted/total format
        if (highlightedSAEIndices.length > 0 && selectedNodeId === null && nodeData.sae_indices) {
          const highlightedCount = nodeData.sae_indices.filter(saeIndex => 
            highlightedSAEIndices.includes(String(saeIndex))
          ).length;
          
          if (highlightedCount > 0) {
            labelText = `${highlightedCount}/${nodeData.sae_count}`;
          }
        }
        
        label.text(labelText);
      });
    }, 100);
    
    return () => clearTimeout(timeoutId);
  }, [highlightedSAEIndices, selectedNodeId, data]);

  // Update edge highlighting when selectedEdge changes
  useEffect(() => {
    if (!data || !svgRef.current) return;
    
    const svg = d3.select(svgRef.current);
    const edges = svg.selectAll(".links line");
    
    edges.each(function() {
      try {
        const edgeData = d3.select(this).datum();
        if (!edgeData) return;
        
        const isSelected = selectedEdge && 
          ((edgeData.source === selectedEdge.source && edgeData.target === selectedEdge.target) ||
           (edgeData.source === selectedEdge.target && edgeData.target === selectedEdge.source));
        
        d3.select(this)
          .attr("stroke", isSelected ? "#FF8C00" : "#999")
          .attr("stroke-width", isSelected ? 4 : 2)
          .attr("stroke-opacity", isSelected ? 1 : 0.6);
      } catch (error) {
        console.warn("Error updating edge highlighting:", error);
      }
    });
  }, [selectedEdge, data]);

  if (!layerDetails) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Typography level="h6">No layer data available</Typography>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Typography level="body-sm" color="neutral">Loading BallMapper...</Typography>
      </Box>
    );
  }

  if (data && data.error) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', flexDirection: 'column', gap: 1 }}>
        <Typography level="body-sm" color="danger" sx={{ textAlign: 'center' }}>
          {data.error}
        </Typography>
        <Typography level="body-xs" color="neutral" sx={{ textAlign: 'center' }}>
          Try selecting a different category or concept
        </Typography>
      </Box>
    );
  }



  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
          <Typography level="h6">
            BallMapper
          </Typography>
          <Tooltip 
            title={
              <Box sx={{ 
                maxWidth: 300,
                backgroundColor: 'background.surface',
                color: 'text.primary',
                p: 1
              }}>
                <Typography level="body-sm" sx={{ fontWeight: 'bold', mb: 0.5, color: 'text.primary' }}>
                  BallMapper Visualization
                </Typography>
                <Typography level="body-xs" sx={{ mb: 0.5, color: 'text.primary' }}>
                  Shows a network graph where nodes represent clusters of features with high cosine similarities. 
                  Nodes are connected if they share common features, revealing relationships between feature groups.
                </Typography>
                <Typography level="body-xs" sx={{ fontWeight: 'bold', mb: 0.25, color: 'text.primary' }}>
                  Interactions:
                </Typography>
                <Typography level="body-xs" sx={{ mb: 0.25, color: 'text.primary' }}>
                  • Click on a node to select it and view its features
                </Typography>
                <Typography level="body-xs" sx={{ mb: 0.25, color: 'text.primary' }}>
                  • Click on an edge to see shared features between nodes
                </Typography>
                <Typography level="body-xs" sx={{ mb: 0.25, color: 'text.primary' }}>
                  • Drag nodes to rearrange the layout
                </Typography>
                <Typography level="body-xs" sx={{ color: 'text.primary' }}>
                  • Use the layout slider to adjust between anchored (by UMAP) and force-directed layouts
                </Typography>
              </Box>
            } 
            placement="bottom-start"
            arrow
            sx={{
              '& .MuiTooltip-tooltip': {
                backgroundColor: 'background.surface',
                color: 'text.primary',
                border: '1px solid',
                borderColor: 'divider'
              }
            }}
          >
            <IconButton size="sm" variant="plain" sx={{ p: 0.1, minWidth: 'auto', minHeight: 'auto' }}>
              <HelpOutlineIcon sx={{ fontSize: '18px', color: 'neutral.400' }} />
            </IconButton>
          </Tooltip>
          <Typography level="h6" sx={{ color: '#666', fontSize: '0.8em', fontWeight: 'normal' }}>
            {isComparisonMode && pinnedCategory && comparisonCategory && (
              <span>
                (Filtered: {pinnedCategory} + {comparisonCategory})
              </span>
            )}
            {!isComparisonMode && selectedCategory && (
              <span>
                (Filtered: {selectedCategory})
              </span>
            )}
          </Typography>
        </Box>
        {data && (
          <Typography level="body-xs" color="neutral">
            Nodes: {data.nodes.length} | Edges: {data.edges.length} | Features: {data.total_saes}
          </Typography>
        )}
      </Box>
      
      <Box sx={{ flex: 1 }}>
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          style={{ border: '1px solid #ccc', borderRadius: '4px' }}
        />
      </Box>
      
      {/* Footer: Layout control (outside) + Parameters button */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.25, height: '28px' }}>
        {/* Layout Control (outside) */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography level="body-xs" sx={{ minWidth: '35px', fontSize: '0.75rem', mr: 1, opacity: 0.7 }}>
            Layout:
          </Typography>
          <Typography level="body-xs" sx={{ minWidth: '50px', fontSize: '0.75rem', mr: 0.5, opacity: 0.7 }}>
            Anchored
          </Typography>
          <Slider
            value={layoutMix}
            onChange={(event, newValue) => setLayoutMix(newValue)}
            min={0}
            max={1}
            step={0.1}
            size="sm"
            sx={{ 
              width: 120,
              padding: '4px 0px',
              mx: 0.5,
              '& .MuiSlider-track': { height: 2 },
              '& .MuiSlider-rail': { height: 2 },
              '& .MuiSlider-thumb': { width: 12, height: 12 }
            }}
          />
          <Typography level="body-xs" sx={{ minWidth: '90px', fontSize: '0.75rem', ml: 0.5, opacity: 0.7 }}>
            Force-Directed
          </Typography>
        </Box>

        {/* Parameters trigger */}
        <Tooltip title="BallMapper Parameters" placement="top">
          <IconButton
            size="sm"
            variant="outlined"
            color="neutral"
            onClick={() => {
              setDraftEpsilon(epsilon ?? computedEpsilon ?? 0);
              setDraftUseCustomEpsilon(useCustomEpsilon);
              setDraftMaxSize(maxSize);
              setParamsOpen(true);
            }}
            sx={{ minHeight: 'auto', height: 22, width: 22, p: 0.25 }}
          >
            <TuneIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Parameters Modal */}
      <Modal open={paramsOpen} onClose={() => setParamsOpen(false)}>
        <ModalDialog sx={{ minWidth: 600, maxWidth: 760, p: 1 }}>
          <DialogTitle sx={{ py: 0.5 }}>BallMapper Parameters</DialogTitle>
          <DialogContent sx={{ py: 0.5 }}>
            {data && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography level="body-sm" sx={{ opacity: 0.8, whiteSpace: 'nowrap' }}>Ball Radius</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <Slider
                    value={draftEpsilon || 0}
                    onChange={(event, newValue) => {
                      setDraftEpsilon(newValue);
                      setDraftUseCustomEpsilon(true);
                    }}
                    min={0.1}
                    max={2.0}
                    step={0.01}
                    size="sm"
                    disabled={!draftUseCustomEpsilon}
                    sx={{ width: 260, ml: 0.5, mr: 0.5, '& .MuiSlider-track': { height: 2 }, '& .MuiSlider-rail': { height: 2 }, '& .MuiSlider-thumb': { width: 12, height: 12 } }}
                  />
                  <Typography level="body-xs" sx={{ minWidth: '40px', ml: 0.5, opacity: 0.7 }}>
                    {draftEpsilon ? draftEpsilon.toFixed(2) : '0.00'}
                  </Typography>
                  <Switch
                    size="sm"
                    checked={draftUseCustomEpsilon}
                    onChange={(e) => setDraftUseCustomEpsilon(e.target.checked)}
                    sx={{ ml: 0.5 }}
                    endDecorator={
                      <Typography level="body-xs" sx={{ ml: 0.5 }}>
                        {draftUseCustomEpsilon ? 'Custom' : 'Auto'}
                      </Typography>
                    }
                  />
                </Box>
              </Box>
            )}

            {/* Max Size control */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
              <Typography level="body-sm" sx={{ opacity: 0.8, whiteSpace: 'nowrap' }}>Max Size</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Slider
                  value={draftMaxSize}
                  onChange={(e, v) => setDraftMaxSize(Array.isArray(v) ? v[0] : v)}
                  min={1}
                  max={10}
                  step={1}
                  size="sm"
                  sx={{ width: 220, ml: 0.5, mr: 0.5, '& .MuiSlider-track': { height: 2 }, '& .MuiSlider-rail': { height: 2 }, '& .MuiSlider-thumb': { width: 12, height: 12 } }}
                />
                <Typography level="body-xs" sx={{ minWidth: '20px', ml: 0.5, opacity: 0.7 }}>
                  {draftMaxSize}
                </Typography>
              </Box>
            </Box>
          </DialogContent>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 0.5 }}>
            <Button size="sm" variant="plain" color="neutral" onClick={() => setParamsOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              variant="solid"
              color="primary"
              onClick={() => {
                // Commit changes
                if (draftUseCustomEpsilon) {
                  setUseCustomEpsilon(true);
                  setEpsilon(draftEpsilon);
                } else {
                  setUseCustomEpsilon(false);
                  // Let fetchBallMapperData compute epsilon; it will set computed in Auto mode
                }
                setMaxSize(draftMaxSize);
                setParamsOpen(false);
                // Trigger refetch immediately to apply new parameters
                setTimeout(() => {
                  fetchBallMapperData();
                }, 0);
              }}
            >
              Apply
            </Button>
          </Box>
        </ModalDialog>
      </Modal>

    </Box>
  );
};

export default BallMapperVisualization;

