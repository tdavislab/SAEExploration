import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Box, Typography, IconButton, Tooltip } from '@mui/joy';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import LassoIcon from '@mui/icons-material/ContentCut';
import * as d3 from 'd3';

const UMAPVisualization = ({ layerDetails, selectedCategory, onPointClick, highlightedIndices = [], nearestNeighborIndices = [], onLassoSelection, conceptSearchResults, pinnedCategory, comparisonCategory, currentThreshold, currentConceptDataset, onLoaded }) => {
  const svgRef = useRef();
  const [isLassoMode, setIsLassoMode] = useState(false);
  const [lassoPath, setLassoPath] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  
  // Use refs to store highlighting state that persists across recreations
  const highlightedIndicesRef = useRef([]);
  const nearestNeighborIndicesRef = useRef([]);

  // Check if we're in comparison mode
  const isComparisonMode = pinnedCategory && comparisonCategory && pinnedCategory !== comparisonCategory;
  
  // Get all SAEs with coordinates for visualization
  const allSAEsWithCoordinates = layerDetails.saes.filter(sae => sae.umap_coordinates);

  // Determine which SAEs are in the selected category/comparison mode
  const getSAEInSelectedCategory = useCallback((sae) => {
    if (isComparisonMode) {
      return sae.all_categories.includes(pinnedCategory) || sae.all_categories.includes(comparisonCategory);
    } else if (selectedCategory) {
      return sae.all_categories.includes(selectedCategory);
    }
    return true; // If no category selected, all SAEs are considered "selected"
  }, [isComparisonMode, selectedCategory, pinnedCategory, comparisonCategory]);

  // Determine SAE types for comparison mode coloring
  const getSAEType = useCallback((sae) => {
    if (!isComparisonMode || !pinnedCategory || !comparisonCategory) {
      return 'normal'; // Not in comparison mode
    }
    
    const hasPinned = sae.all_categories.includes(pinnedCategory);
    const hasComparison = sae.all_categories.includes(comparisonCategory);
    
    if (hasPinned && hasComparison) {
      return 'shared'; // SAE belongs to both categories
    } else if (hasPinned) {
      return 'pinned'; // SAE belongs only to pinned category
    } else if (hasComparison) {
      return 'comparison'; // SAE belongs only to comparison category
    } else {
      return 'other'; // SAE doesn't belong to either category
    }
  }, [isComparisonMode, pinnedCategory, comparisonCategory]);

  // Color scheme for comparison mode
  const getSAEColor = useCallback((saeType) => {
    switch (saeType) {
      case 'pinned':
        return '#1976D2'; // Blue for pinned category
      case 'comparison':
        return '#D32F2F'; // Red for comparison category
      case 'shared':
        return '#9C27B0'; // Purple for shared SAEs (changed back from green)
      default:
        return '#666666'; // Gray for other SAEs
    }
  }, []);

  // Function to lighten a color
  const lightenColor = useCallback((color, factor) => {
    // Convert hex to RGB
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    
    // Lighten by factor (0-1, where 1 is white)
    const newR = Math.round(r + (255 - r) * factor);
    const newG = Math.round(g + (255 - g) * factor);
    const newB = Math.round(b + (255 - b) * factor);
    
    // Convert back to hex
    return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
  }, []);

  const createVisualization = useCallback(() => {
    console.log("🔄 Creating visualization with onPointClick:", !!onPointClick);
    if (!allSAEsWithCoordinates.length || !svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // Remove any existing tooltips
    d3.selectAll(".umap-tooltip").remove();

    // Get SVG dimensions
    const svgElement = svgRef.current;
    const rect = svgElement.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    // Compute data extents
    const xExtent = d3.extent(allSAEsWithCoordinates, d => d.umap_coordinates[0]);
    const yExtent = d3.extent(allSAEsWithCoordinates, d => d.umap_coordinates[1]);
    let xMin = xExtent[0];
    let xMax = xExtent[1];
    let yMin = yExtent[0];
    let yMax = yExtent[1];

    // Add small padding to data bounds
    const padFrac = 0.02;
    const dw0 = xMax - xMin;
    const dh0 = yMax - yMin;
    xMin -= dw0 * padFrac;
    xMax += dw0 * padFrac;
    yMin -= dh0 * padFrac;
    yMax += dh0 * padFrac;

    // Enforce equal aspect ratio (no distortion)
    let dw = xMax - xMin;
    let dh = yMax - yMin;
    const scaleX = width / dw;
    const scaleY = height / dh;
    const s = Math.min(scaleX, scaleY);

    // Expand the domain of the limiting axis to match the other so scaleX == scaleY == s
    const xCenter = (xMin + xMax) / 2;
    const yCenter = (yMin + yMax) / 2;

    if (scaleX < scaleY) {
      // X is limiting; expand Y domain
      const dhPrime = height / s; // desired data height
      const half = dhPrime / 2;
      yMin = yCenter - half;
      yMax = yCenter + half;
    } else if (scaleY < scaleX) {
      // Y is limiting; expand X domain
      const dwPrime = width / s; // desired data width
      const half = dwPrime / 2;
      xMin = xCenter - half;
      xMax = xCenter + half;
    }

    // Debug: Verify aspect ratio preservation
    const finalDw = xMax - xMin;
    const finalDh = yMax - yMin;
    const finalScaleX = width / finalDw;
    const finalScaleY = height / finalDh;
    console.log("Aspect ratio check:");
    console.log("  Original scales:", { scaleX: scaleX.toFixed(3), scaleY: scaleY.toFixed(3) });
    console.log("  Final scales:", { scaleX: finalScaleX.toFixed(3), scaleY: finalScaleY.toFixed(3) });
    console.log("  Scale ratio:", (finalScaleX / finalScaleY).toFixed(6));
    console.log("  Data dimensions:", { width: finalDw.toFixed(3), height: finalDh.toFixed(3) });
    console.log("  Display dimensions:", { width, height });

    // Create scales with equal aspect ratio
    const xScale = d3.scaleLinear()
      .domain([xMin, xMax])
      .range([0, width]);

    const yScale = d3.scaleLinear()
      .domain([yMin, yMax])
      .range([height, 0]);

    // Verify scales are equal (aspect ratio preserved)
    const actualScaleX = width / (xMax - xMin);
    const actualScaleY = height / (yMin - yMax); // Note: yScale is inverted
    console.log("Final verification - scales should be equal:");
    console.log("  X scale:", actualScaleX.toFixed(6));
    console.log("  Y scale:", actualScaleY.toFixed(6));
    console.log("  Equal?", Math.abs(actualScaleX - actualScaleY) < 0.000001);

    // Create zoom behavior (wheel to zoom, drag to pan)
    const g = svg.append("g");

    const zoom = d3.zoom()
      .scaleExtent([0.5, 10])
      .on("zoom", (event) => {
        const { transform } = event;
        g.attr("transform", transform);
      });

    // Apply zoom to SVG only if not in LASSO mode
    if (!isLassoMode) {
    svg.call(zoom);
    }

    // Create tooltip (keep it in DOM)
    const tooltip = d3.select("body").append("div")
      .attr("class", "umap-tooltip")
      .style("opacity", 0)
      .style("position", "absolute")
      .style("background", "rgba(0, 0, 0, 0.9)")
      .style("color", "white")
      .style("padding", "10px 15px")
      .style("border-radius", "6px")
      .style("font-size", "12px")
      .style("pointer-events", "none")
      .style("z-index", "10000")
      .style("max-width", "350px")
      .style("white-space", "normal")
      .style("box-shadow", "0 4px 8px rgba(0, 0, 0, 0.3)")
      .style("border", "1px solid rgba(255, 255, 255, 0.2)");

    console.log("Tooltip created:", tooltip.node()); // Debug log

    // Sort data so selected SAEs are rendered last (on top)
    const sortedData = [...allSAEsWithCoordinates].sort((a, b) => {
      const aSelected = getSAEInSelectedCategory(a);
      const bSelected = getSAEInSelectedCategory(b);
      return aSelected === bSelected ? 0 : aSelected ? 1 : -1; // Selected SAEs come last
    });

    // Create nodes
    g.selectAll(".node")
      .data(sortedData)
      .enter()
      .append("circle")
      .attr("class", "node")
      .attr("cx", d => xScale(d.umap_coordinates[0]))
      .attr("cy", d => yScale(d.umap_coordinates[1]))
      .attr("r", 4)
      .attr("fill", d => {
        // Use comparison mode colors if in comparison mode
        if (isComparisonMode) {
          const saeType = getSAEType(d);
          const baseColor = getSAEColor(saeType);
          const isSelected = getSAEInSelectedCategory(d);
          // Use lighter color for background nodes instead of opacity
          return isSelected ? baseColor : lightenColor(baseColor, 0.7);
        }
        // For normal mode, use lighter gray for background nodes
        const isSelected = getSAEInSelectedCategory(d);
        return isSelected ? "#666666" : "#E0E0E0"; // Light gray for background
      })
      .attr("opacity", 1) // Always use full opacity, control visibility through color
      .attr("stroke", "white")
      .attr("stroke-width", 1)
      .style("cursor", "pointer")
      .on("mouseover", function(event, d) {
        console.log("Mouse over SAE:", d.index); // Debug log
        
        // Check if this point is currently highlighted
        const isHighlighted = highlightedIndicesRef.current.includes(String(d.index));
        const isNearestNeighbor = nearestNeighborIndicesRef.current.includes(String(d.index));
        const isSearchResult = conceptSearchResults && conceptSearchResults.matchingSaeIndices && 
                              conceptSearchResults.matchingSaeIndices.includes(String(d.index));
        
        // Only apply hover effects if not already highlighted
        if (!isHighlighted && !isNearestNeighbor && !isSearchResult) {
          // Enlarge the point only if it's not already highlighted
        d3.select(this)
          .attr("r", 6)
          .attr("opacity", 1)
          .attr("stroke-width", 2);
        }

        const tooltipContent = `
          <strong>Explanation:</strong> ${d.explanation || "No explanation available"}
        `;

        // Show tooltip immediately
        tooltip.html(tooltipContent)
          .style("left", (event.pageX + 10) + "px")
          .style("top", (event.pageY - 28) + "px")
          .style("opacity", 1);
      })
      .on("mousemove", function(event) {
        // Update tooltip position as mouse moves
        tooltip
          .style("left", (event.pageX + 10) + "px")
          .style("top", (event.pageY - 28) + "px");
      })
      .on("mouseout", function(event, d) {
        console.log("Mouse out SAE"); // Debug log
        
        // Check if this point is currently highlighted
        const isHighlighted = highlightedIndicesRef.current.includes(String(d.index));
        const isNearestNeighbor = nearestNeighborIndicesRef.current.includes(String(d.index));
        const isSearchResult = conceptSearchResults && conceptSearchResults.matchingSaeIndices && 
                              conceptSearchResults.matchingSaeIndices.includes(String(d.index));
        
        // Only restore basic styling if not highlighted
        if (!isHighlighted && !isNearestNeighbor && !isSearchResult) {
          // Restore original opacity based on selection status
          const isSelected = getSAEInSelectedCategory(d);
          const originalOpacity = isSelected ? 0.8 : 0.6;
          
          d3.select(this)
            .attr("r", 4)
            .attr("opacity", originalOpacity)
            .attr("stroke-width", 1);
        }

        // Hide tooltip
        tooltip.style("opacity", 0);
      })
      .on("click", function(event, d) {
        console.log("🎯 UMAP NODE CLICKED:", d.index);
        console.log("🎯 Event details:", { isLassoMode, onPointClickExists: !!onPointClick, onPointClickType: typeof onPointClick });
        // Only handle point clicks if not in LASSO mode
        if (!isLassoMode && onPointClick) {
          console.log("🎯 Calling onPointClick with:", d.index);
          onPointClick(d.index);
        } else {
          console.log("🎯 Not calling onPointClick - isLassoMode:", isLassoMode, "onPointClick exists:", !!onPointClick, "onPointClick type:", typeof onPointClick);
        }
      })
      .on("mousedown", function(event, d) {
        console.log("🎯 UMAP NODE MOUSEDOWN:", d.index);
      })
      .on("mouseup", function(event, d) {
        console.log("🎯 UMAP NODE MOUSEUP:", d.index);
      });
    
    console.log("🔄 Attached click handlers to", allSAEsWithCoordinates.length, "nodes");

    // Call onLoaded callback when visualization is complete
    if (onLoaded) {
      onLoaded();
    }

  }, [allSAEsWithCoordinates, onPointClick, isLassoMode, onLoaded]); // Minimal dependencies - styling handled by highlighting useEffect

  useEffect(() => {
    if (layerDetails && allSAEsWithCoordinates.length > 0) {
      createVisualization();
    }
  }, [layerDetails, allSAEsWithCoordinates]); // Only recreate when data changes

  // Update refs when props change
  useEffect(() => {
    console.log("🔄 UPDATING REFS - highlightedIndices:", highlightedIndices);
    console.log("🔄 UPDATING REFS - nearestNeighborIndices:", nearestNeighborIndices);
    highlightedIndicesRef.current = highlightedIndices;
    nearestNeighborIndicesRef.current = nearestNeighborIndices;
    console.log("🔄 REFS UPDATED - highlightedIndicesRef.current:", highlightedIndicesRef.current);
    console.log("🔄 REFS UPDATED - nearestNeighborIndicesRef.current:", nearestNeighborIndicesRef.current);
  }, [highlightedIndices, nearestNeighborIndices]);

  // Update highlighting when highlightedIndices changes
  useEffect(() => {
    console.log("🎨 HIGHLIGHTING useEffect triggered!");
    console.log("🎨 highlightedIndices:", highlightedIndices);
    console.log("🎨 nearestNeighborIndices:", nearestNeighborIndices);
    console.log("🎨 State update timestamp:", new Date().toISOString());
    
    if (!svgRef.current || !allSAEsWithCoordinates.length) {
      console.log("🎨 Early return - no svg or data");
      return;
    }
    
    // Add a longer delay to ensure visualization recreation is complete
    const timeoutId = setTimeout(() => {
    const svg = d3.select(svgRef.current);
    const nodes = svg.selectAll(".node");
      console.log("🎨 Found", nodes.size(), "nodes to style");
      
      // Use refs for highlighting state that persists across recreations
      const currentHighlightedIndices = highlightedIndicesRef.current;
      const currentNearestNeighborIndices = nearestNeighborIndicesRef.current;
      
      // Enhanced highlighting logic with search results preservation
      nodes.each(function(d) {
        const isHighlighted = currentHighlightedIndices.includes(String(d.index));
        const isNearestNeighbor = currentNearestNeighborIndices.includes(String(d.index));
        const isSearchResult = conceptSearchResults && conceptSearchResults.matchingSaeIndices && 
                              conceptSearchResults.matchingSaeIndices.includes(String(d.index));
      
        let r, opacity, strokeWidth, strokeColor;
        
        // Priority order: Clicked point > Search result > Nearest neighbor > Default
        if (isHighlighted) {
          // Clicked point (highest priority) - Orange border
          r = 8;
          opacity = 1.0; // Full opacity for selected point
          strokeWidth = 4;
          strokeColor = "#FF8C00"; // Orange
          console.log(`🎨 HIGHLIGHTING NODE ${d.index} with orange border (clicked)`);
        } else if (isSearchResult) {
          // Search result - Blue border
          r = 6;
          opacity = 0.95; // High opacity for search results
          strokeWidth = 3;
          strokeColor = "#1976D2"; // Blue
          console.log(`🎨 HIGHLIGHTING NODE ${d.index} with blue border (search result)`);
        } else if (isNearestNeighbor) {
          // Nearest neighbor points - Green border
          r = 6;
          opacity = 0.9; // Medium-high opacity for nearest neighbors
          strokeWidth = 3;
          strokeColor = "#4CAF50"; // Green
          console.log(`🎨 HIGHLIGHTING NODE ${d.index} with green border (nearest neighbor)`);
        } else {
          // Default points - use opacity based on selection status
          r = 4;
          const isSelected = getSAEInSelectedCategory(d);
          opacity = isSelected ? 0.8 : 0.6; // Higher opacity for foreground, lower for background
          strokeWidth = 1;
          strokeColor = "white";
        }
        
        // Determine fill color based on comparison mode and selection status
        let fillColor;
        if (isComparisonMode) {
          const saeType = getSAEType(d);
          const baseColor = getSAEColor(saeType);
          const isSelected = getSAEInSelectedCategory(d);
          fillColor = isSelected ? baseColor : lightenColor(baseColor, 0.7);
        } else {
          const isSelected = getSAEInSelectedCategory(d);
          fillColor = isSelected ? "#666666" : "#E0E0E0";
        }
        
        // Apply the styling
        d3.select(this)
          .attr("r", r)
          .attr("opacity", opacity)
          .attr("stroke-width", strokeWidth)
          .attr("stroke", strokeColor)
          .attr("fill", fillColor);
      });
      
      // Reorder nodes so highlighted points are rendered on top
      // This must happen AFTER styling to ensure proper z-index
      const nodesArray = nodes.nodes();
      const sortedNodes = nodesArray.sort((a, b) => {
        const aData = d3.select(a).datum();
        const bData = d3.select(b).datum();
        
        const aIsHighlighted = currentHighlightedIndices.includes(String(aData.index));
        const bIsHighlighted = currentHighlightedIndices.includes(String(bData.index));
        const aIsNearestNeighbor = currentNearestNeighborIndices.includes(String(aData.index));
        const bIsNearestNeighbor = currentNearestNeighborIndices.includes(String(bData.index));
        const aIsSearchResult = conceptSearchResults && conceptSearchResults.matchingSaeIndices && 
                               conceptSearchResults.matchingSaeIndices.includes(String(aData.index));
        const bIsSearchResult = conceptSearchResults && conceptSearchResults.matchingSaeIndices && 
                               conceptSearchResults.matchingSaeIndices.includes(String(bData.index));
        
        // Priority: highlighted > search result > nearest neighbor > default
        if (aIsHighlighted && !bIsHighlighted) return -1;
        if (!aIsHighlighted && bIsHighlighted) return 1;
        if (aIsSearchResult && !bIsSearchResult) return -1;
        if (!aIsSearchResult && bIsSearchResult) return 1;
        if (aIsNearestNeighbor && !bIsNearestNeighbor) return -1;
        if (!aIsNearestNeighbor && bIsNearestNeighbor) return 1;
        return 0;
      });
      
      // Reorder DOM elements to ensure proper rendering order
      const parent = nodesArray[0]?.parentNode;
      if (parent) {
        sortedNodes.forEach(node => {
          parent.appendChild(node);
        });
        console.log("🎨 Reordered DOM elements to ensure highlighted points render on top");
      }
    }, 200); // Increased delay even more to ensure visualization recreation is complete
    
    return () => clearTimeout(timeoutId);
  }, [highlightedIndices, nearestNeighborIndices, conceptSearchResults, allSAEsWithCoordinates, isComparisonMode, getSAEType, getSAEColor, getSAEInSelectedCategory, lightenColor]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      if (layerDetails && allSAEsWithCoordinates.length > 0) {
        createVisualization();
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [layerDetails, allSAEsWithCoordinates]); // Removed createVisualization dependency

  // Handle zoom behavior based on LASSO mode
  useEffect(() => {
    if (!svgRef.current) return;
    
    const svg = d3.select(svgRef.current);
    
    if (isLassoMode) {
      // Disable zoom when in LASSO mode and reset transform to identity
      svg.on('.zoom', null);
      const g = svg.select('g');
      g.attr('transform', 'translate(0,0) scale(1)');
    } else {
      // Re-enable zoom when not in LASSO mode
      // Don't recreate visualization, just re-enable zoom
      const zoom = d3.zoom()
        .scaleExtent([0.1, 10])
        .on('zoom', (event) => {
          const g = svg.select('g');
          g.attr('transform', event.transform);
        });
      svg.call(zoom);
      
      // Reset to identity transform when exiting LASSO mode
      // This ensures the view stays at the reset level
      svg.call(zoom.transform, d3.zoomIdentity);
    }
  }, [isLassoMode]);

  // LASSO functionality
  const handleLassoToggle = () => {
    setIsLassoMode(!isLassoMode);
    if (isLassoMode) {
      // Clear lasso selection when turning off
      setLassoPath([]);
      setIsDrawing(false);
      if (onLassoSelection) {
        onLassoSelection([]);
      }
    }
  };

  const handleMouseDown = (event) => {
    if (!isLassoMode) return;
    
    event.preventDefault();
    event.stopPropagation();
    
    const svg = d3.select(svgRef.current);
    const g = svg.select("g");
    const transform = d3.zoomTransform(svg.node());
    
    // Get coordinates relative to the transformed group
    const coords = d3.pointer(event, g.node());
    
    console.log("LASSO mouse down:", coords, "transform:", transform);
    setIsDrawing(true);
    setLassoPath([coords]);
  };

  const handleMouseMove = (event) => {
    if (!isLassoMode || !isDrawing) return;
    
    event.preventDefault();
    event.stopPropagation();
    
    const svg = d3.select(svgRef.current);
    const g = svg.select("g");
    
    // Get coordinates relative to the transformed group
    const coords = d3.pointer(event, g.node());
    
    console.log("LASSO mouse move:", coords);
    setLassoPath(prev => [...prev, coords]);
  };

  const handleMouseUp = (event) => {
    if (!isLassoMode || !isDrawing) return;
    
    event.preventDefault();
    event.stopPropagation();
    
    console.log("LASSO mouse up, path length:", lassoPath.length);
    setIsDrawing(false);
    
    // Find points within the lasso path
    if (lassoPath.length > 2) {
      const svg = d3.select(svgRef.current);
      const rect = svg.node().getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      
      // Recalculate scales and transforms for the current view
      const xExtent = d3.extent(allSAEsWithCoordinates, d => d.umap_coordinates[0]);
      const yExtent = d3.extent(allSAEsWithCoordinates, d => d.umap_coordinates[1]);
      
      // Add padding to match the visualization
      const padFrac = 0.02;
      const dw0 = xExtent[1] - xExtent[0];
      const dh0 = yExtent[1] - yExtent[0];
      let xMin = xExtent[0] - dw0 * padFrac;
      let xMax = xExtent[1] + dw0 * padFrac;
      let yMin = yExtent[0] - dh0 * padFrac;
      let yMax = yExtent[1] + dh0 * padFrac;
      
      // Enforce equal aspect ratio
      let dw = xMax - xMin;
      let dh = yMax - yMin;
      const scaleX = width / dw;
      const scaleY = height / dh;
      const s = Math.min(scaleX, scaleY);
      
      const xCenter = (xMin + xMax) / 2;
      const yCenter = (yMin + yMax) / 2;
      
      if (scaleX < scaleY) {
        const dhPrime = height / s;
        const half = dhPrime / 2;
        yMin = yCenter - half;
        yMax = yCenter + half;
      } else if (scaleY < scaleX) {
        const dwPrime = width / s;
        const half = dwPrime / 2;
        xMin = xCenter - half;
        xMax = xCenter + half;
      }
      
      const xScale = d3.scaleLinear()
        .domain([xMin, xMax])
        .range([0, width]);
      
      const yScale = d3.scaleLinear()
        .domain([yMin, yMax])
        .range([height, 0]);
      
      const selectedPoints = allSAEsWithCoordinates.filter(sae => {
        // Convert UMAP coordinates to screen coordinates using the same scales as the visualization
        const screenX = xScale(sae.umap_coordinates[0]);
        const screenY = yScale(sae.umap_coordinates[1]);
        
        // Check if point is within the lasso path
        const isInLassoPath = isPointInPolygon([screenX, screenY], lassoPath);
        
        // Check if point belongs to the selected category (foreground points only)
        const isForegroundPoint = getSAEInSelectedCategory(sae);
        
        // Only select points that are both in the lasso path AND foreground points
        return isInLassoPath && isForegroundPoint;
      });
      
      console.log("LASSO selected points:", selectedPoints.length);
      if (onLassoSelection) {
        onLassoSelection(selectedPoints);
      }
    }
    
    setLassoPath([]);
  };

  // Point-in-polygon algorithm
  const isPointInPolygon = (point, polygon) => {
    const [x, y] = point;
    let inside = false;
    
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];
      
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    
    return inside;
  };

  if (!layerDetails) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Typography level="h6">No layer data available</Typography>
      </Box>
    );
  }

  if (allSAEsWithCoordinates.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
        <Typography level="h6">
          No SAEs with UMAP coordinates available
          {selectedCategory && ` for category: ${selectedCategory}`}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
        <Typography level="h6">
          UMAP
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
                  UMAP Visualization
                </Typography>
                <Typography level="body-xs" sx={{ mb: 0.5, color: 'text.primary' }}>
                  Shows a 2D projection of all features using UMAP dimensionality reduction. 
                  Features are positioned based on their cosine similarity in the high-dimensional space.
                </Typography>
                <Typography level="body-xs" sx={{ fontWeight: 'bold', mb: 0.25, color: 'text.primary' }}>
                  Interactions:
                </Typography>
                <Typography level="body-xs" sx={{ mb: 0.25, color: 'text.primary' }}>
                  • Click on a point to select it and view details
                </Typography>
                <Typography level="body-xs" sx={{ mb: 0.25, color: 'text.primary' }}>
                  • Use LASSO tool to select multiple points by drawing
                </Typography>
                <Typography level="body-xs" sx={{ mb: 0.25, color: 'text.primary' }}>
                  • Zoom and pan to explore the visualization
                </Typography>
                <Typography level="body-xs" sx={{ color: 'text.primary' }}>
                  • Hover over points to see explanations
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
                (Highlighted: {pinnedCategory} + {comparisonCategory})
              </span>
            )}
            {!isComparisonMode && selectedCategory && (
              <span>
                (Highlighted: {selectedCategory})
              </span>
            )}
            {isLassoMode && (
              <span style={{ color: '#1976d2', fontWeight: 'bold' }}>
                (LASSO Mode)
            </span>
          )}
        </Typography>
        </Box>
        <Typography level="body-xs" color="neutral">
          {allSAEsWithCoordinates.length} features
        </Typography>
      </Box>
      

      
      <Box sx={{ flex: 1, position: 'relative' }}>
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          style={{ 
            border: '1px solid #ccc', 
            borderRadius: '4px',
            cursor: isLassoMode ? 'crosshair' : 'default'
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
        {/* LASSO path overlay */}
        {isLassoMode && lassoPath.length > 0 && (
          <svg
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              zIndex: 10
            }}
          >
            <path
              d={`M ${lassoPath.map(p => p.join(',')).join(' L ')}`}
              fill="none"
              stroke="#1976d2"
              strokeWidth="2"
              strokeDasharray="5,5"
              opacity="0.8"
            />
          </svg>
        )}
      </Box>
      
      {/* LASSO Control */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.25, height: '28px' }}>
        <Tooltip title="Click and drag to select points" placement="top">
          <IconButton
            size="sm"
            variant={isLassoMode ? "solid" : "outlined"}
            color="primary"
            onClick={handleLassoToggle}
            sx={{ 
              fontSize: '0.75rem',
              px: 0.5,
              py: 0.25,
              minHeight: 'auto',
              height: '20px',
              width: '20px'
            }}
          >
            <LassoIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Typography level="body-xs" color="neutral" sx={{ fontSize: '0.65rem', minWidth: '45px' }}>
          LASSO
        </Typography>
      </Box>
    </Box>
  );
};

export default UMAPVisualization;
