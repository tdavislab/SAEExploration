import React, { useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/joy';
import * as d3 from 'd3';

const LayerSummary = ({ layerData, onLayerSelect, selectedLayer }) => {
  const svgRef = useRef(null);

  useEffect(() => {
    console.log('LayerSummary component rendered with layerData:', layerData);
    if (!layerData || !layerData.layers || !svgRef.current) return;

    // Clear previous chart
    d3.select(svgRef.current).selectAll("*").remove();

    // Get parent container dimensions
    const container = svgRef.current.parentElement;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    const margin = { top: 40, right: 15, bottom: 10, left: 50 }; // Increased top margin for labels, kept bottom for x-axis
    const width = containerWidth - margin.left - margin.right;
    const height = containerHeight - margin.top - margin.bottom - 35; // Reduced chart height by 10px

    const svg = d3.select(svgRef.current)
      .attr('width', containerWidth)
      .attr('height', containerHeight)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Create tooltip
    const tooltip = d3.select('body').append('div')
      .attr('class', 'tooltip')
      .style('position', 'absolute')
      .style('background', 'rgba(0, 0, 0, 0.8)')
      .style('color', 'white')
      .style('padding', '8px')
      .style('border-radius', '4px')
      .style('font-size', '10px')
      .style('pointer-events', 'none')
      .style('opacity', 0)
      .style('z-index', 1000);

    // X scale
    const x = d3.scaleBand()
      .domain(layerData.layers.map(d => d.layer))
      .range([0, width])
      .padding(0.3); // Increased padding for larger gaps

    // Y scale
    const y = d3.scaleLinear()
      .domain([0, d3.max(layerData.layers, d => d.concept_coverage)])
      .range([height, 0]);

    // Add X axis
    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x))
      .selectAll('text')
      .style('text-anchor', 'middle')
      .style('fill', '#666666'); // MUI Joy neutral color

    // Add X axis label at the beginning of the axis
    svg.append('text')
      .attr('x', 0)
      .attr('y', height+15) // Moved up from height + 15 to ensure visibility
      .attr('text-anchor', 'end')
      .style('font-size', '11px')
      .style('fill', '#666666') // MUI Joy neutral color
      .text('Layer');

    // Add Y axis with fewer ticks
    svg.append('g')
      .call(d3.axisLeft(y).ticks(3).tickFormat(d => `${d}%`))
      .selectAll('text')
      .style('fill', '#666666'); // MUI Joy neutral color

    // Add Y axis label
    svg.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -margin.left+15)
      .attr('x', -height / 2)
      .attr('text-anchor', 'middle')
      .style('font-size', '10px')
      .style('fill', '#666666') // MUI Joy neutral color
      .text('Concept Coverage');

    // Add bars with MUI Joy colors
    svg.selectAll('.bar')
      .data(layerData.layers)
      .enter()
      .append('rect')
      .attr('class', 'bar')
      .attr('x', d => x(d.layer))
      .attr('width', x.bandwidth())
      .attr('y', d => y(d.concept_coverage))
      .attr('height', d => height - y(d.concept_coverage) - 1) // Subtract 1 to avoid overlap with x-axis
      .attr('fill', d => d.layer === selectedLayer ? '#0B6BCB' : '#E1E5E9') // MUI Joy blue for selected, light gray for unselected
      .attr('stroke', d => d.layer === selectedLayer ? '#0B6BCB' : '#C1C7CD') // MUI Joy colors for strokes
      .attr('stroke-width', d => d.layer === selectedLayer ? 2 : 1)
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        onLayerSelect(d.layer);
      })
      .on('mouseover', function(event, d) {
        d3.select(this)
          .attr('fill', d.layer === selectedLayer ? '#0A5BB8' : '#D1D5D9') // Darker blue and darker gray on hover
          .attr('stroke-width', d.layer === selectedLayer ? 3 : 2);
        
        // Show tooltip
        tooltip.transition()
          .duration(200)
          .style('opacity', 1);
        
        tooltip.html(`
          <strong>Layer ${d.layer}</strong><br/>
          Coverage: ${d.concept_coverage.toFixed(1)}%<br/>
          Concepts: ${d.identified_concepts}/${layerData.total_concepts}<br/>
          Features: ${d.total_saes}
        `)
          .style('left', (event.pageX + 10) + 'px')
          .style('top', (event.pageY - 10) + 'px');
      })
      .on('mouseout', function(event, d) {
        d3.select(this)
          .attr('fill', d.layer === selectedLayer ? '#0B6BCB' : '#E1E5E9')
          .attr('stroke-width', d.layer === selectedLayer ? 2 : 1);
        
        // Hide tooltip
        tooltip.transition()
          .duration(500)
          .style('opacity', 0);
      });

    // Add value labels on bars
    svg.selectAll('.bar-label')
      .data(layerData.layers)
      .enter()
      .append('text')
      .attr('class', 'bar-label')
      .attr('x', d => x(d.layer) + x.bandwidth() / 2)
      .attr('y', d => y(d.concept_coverage) - 5)
      .attr('text-anchor', 'middle')
      .style('font-size', '10px')
      .style('font-weight', '500') // Reduced from bold
      .style('fill', '#666666') // MUI Joy neutral color instead of black
      .text(d => `${d.concept_coverage.toFixed(1)}%`);

    // Cleanup function to remove tooltip when component unmounts
    return () => {
      d3.selectAll('.tooltip').remove();
    };

  }, [layerData, selectedLayer, onLayerSelect]);

  if (!layerData || !layerData.layers) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Typography>No layer data available</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <svg ref={svgRef} style={{ width: '100%', height: '100%' }}></svg>
      </Box>
    </Box>
  );
};

export default LayerSummary;
