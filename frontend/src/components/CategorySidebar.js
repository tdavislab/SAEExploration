import React, { useMemo, useEffect, useState } from 'react';
import { Box, Typography, Chip, Tooltip, Input, List, ListItem, ListItemButton, IconButton } from '@mui/joy';
import SearchIcon from '@mui/icons-material/Search';
import PushPinIcon from '@mui/icons-material/PushPin';

const CategorySidebar = ({ categoryDistribution, onCategorySelect, selectedCategory, currentLayer, onConceptSelect, conceptSearchResults, pinnedCategory, onPinCategory, comparisonCategory, currentThreshold, currentConceptDataset }) => {
  const [overlapData, setOverlapData] = useState({});
  const [loading, setLoading] = useState(false);
  const [orderedCategories, setOrderedCategories] = useState(null);
  
  // Concept query state
  const [conceptQuery, setConceptQuery] = useState('');
  const [availableConcepts, setAvailableConcepts] = useState([]);
  const [filteredConcepts, setFilteredConcepts] = useState([]);
  const [showConceptSuggestions, setShowConceptSuggestions] = useState(false);
  
  // Concept search results state
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);

  // Clear search state when layer changes
  useEffect(() => {
    setSearchResults(null);
    setConceptQuery('');
    setShowConceptSuggestions(false);
    setSearchLoading(false);
  }, [currentLayer]);

  // Fetch available concepts when layer changes
  useEffect(() => {
    if (currentLayer !== null && currentLayer !== undefined) {
      fetch(`http://127.0.0.1:5001/api/concepts/${currentLayer}?threshold=${currentThreshold}&concept_dataset_id=${currentConceptDataset}`)
        .then(response => response.json())
        .then(data => {
          if (data.concepts) {
            setAvailableConcepts(data.concepts);
          }
        })
        .catch(error => {
          console.error('Error fetching concepts:', error);
        });
    }
  }, [currentLayer, currentThreshold, currentConceptDataset]);

  // Fetch real overlap data when category is selected
  useEffect(() => {
    if (selectedCategory && currentLayer) {
      setLoading(true);
      fetch(`http://127.0.0.1:5001/api/category-overlaps/${currentLayer}?category=${selectedCategory}&threshold=${currentThreshold}&concept_dataset_id=${currentConceptDataset}`)
        .then(response => response.json())
        .then(data => {
          if (data.overlaps) {
            setOverlapData(data.overlaps);
          }
        })
        .catch(error => {
          console.error('Error fetching overlap data:', error);
        })
        .finally(() => {
          setLoading(false);
        });
    } else {
      setOverlapData({});
    }
  }, [selectedCategory, currentLayer, currentThreshold, currentConceptDataset]);

  // Fetch ordered categories when a category is pinned
  useEffect(() => {
    if (pinnedCategory && currentLayer) {
      console.log('Fetching ordered categories for pinned category:', pinnedCategory);
      fetch(`http://127.0.0.1:5001/api/pinned-category-overlaps/${currentLayer}?pinned_category=${encodeURIComponent(pinnedCategory)}&threshold=${currentThreshold}&concept_dataset_id=${currentConceptDataset}`)
        .then(response => response.json())
        .then(data => {
          if (data.ordered_categories) {
            console.log('Received ordered categories:', data.ordered_categories);
            setOrderedCategories(data.ordered_categories);
          }
        })
        .catch(error => {
          console.error('Error fetching ordered categories:', error);
        });
    } else {
      setOrderedCategories(null);
    }
  }, [pinnedCategory, currentLayer, currentThreshold, currentConceptDataset]);

  // Filter concepts based on query
  useEffect(() => {
    if (conceptQuery.trim() === '') {
      setFilteredConcepts(availableConcepts); // Show all concepts when empty
    } else {
      const filtered = availableConcepts
        .filter(concept => concept.toLowerCase().includes(conceptQuery.toLowerCase()))
        .slice(0, 20); // Limit to 20 suggestions when typing
      setFilteredConcepts(filtered);
    }
  }, [conceptQuery, availableConcepts]);

  // Handle concept selection
  const handleConceptSelect = (concept) => {
    setConceptQuery(concept);
    setShowConceptSuggestions(false);
    
    // Perform concept search
    if (concept && currentLayer !== null && currentLayer !== undefined) {
      setSearchLoading(true);
      fetch(`http://127.0.0.1:5001/api/search-concept/${currentLayer}?concept=${encodeURIComponent(concept)}&threshold=${currentThreshold}&concept_dataset_id=${currentConceptDataset}`)
        .then(response => response.json())
        .then(data => {
          if (data.matching_sae_indices) {
            setSearchResults(data);
            // Clear category selection when searching
            if (onCategorySelect) {
              onCategorySelect(null);
            }
            // Pass search results to parent
            if (onConceptSelect) {
              onConceptSelect(concept, data.matching_sae_indices);
            }
          } else {
            // Handle case where no SAEs are found
            setSearchResults({
              concept: concept,
              total_matching_saes: 0,
              matching_sae_indices: [],
              category_distribution: []
            });
            if (onConceptSelect) {
              onConceptSelect(concept, []);
            }
          }
        })
        .catch(error => {
          console.error('Error searching concept:', error);
        })
        .finally(() => {
          setSearchLoading(false);
        });
    }
  };

  // Handle input key press
  const handleInputKeyPress = (event) => {
    if (event.key === 'Enter') {
      const selectedConcept = conceptQuery.trim();
      if (selectedConcept && availableConcepts.includes(selectedConcept)) {
        handleConceptSelect(selectedConcept);
      } else if (selectedConcept && availableConcepts.some(c => c.toLowerCase() === selectedConcept.toLowerCase())) {
        // Find the exact match with correct case
        const exactMatch = availableConcepts.find(c => c.toLowerCase() === selectedConcept.toLowerCase());
        handleConceptSelect(exactMatch);
      }
    }
  };

  // Clear search results
  const clearSearch = () => {
    setSearchResults(null);
    setConceptQuery('');
    if (onConceptSelect) {
      onConceptSelect(null, null);
    }
  };

  // Handle click outside to close suggestions
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('.concept-query-container')) {
        setShowConceptSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Calculate category data with real overlaps and reordering
  const categoryData = useMemo(() => {
    // Use search results if available, otherwise use regular category distribution
    const distribution = searchResults ? searchResults.category_distribution : categoryDistribution;
    
    if (!distribution || distribution.length === 0) return [];
    
    const maxCount = Math.max(...distribution.map(cat => cat.count));
    
    // If we have ordered categories from pinned category, use that order
    if (orderedCategories && !searchResults) {
      // Create a map of category name to original category data
      const categoryMap = {};
      distribution.forEach(cat => {
        categoryMap[cat.category] = cat;
      });
      
      // Build the reordered list: pinned category first, then ordered by overlap
      const reorderedCategories = [];
      
      // Add pinned category first
      if (pinnedCategory && categoryMap[pinnedCategory]) {
        const pinnedCat = categoryMap[pinnedCategory];
        reorderedCategories.push({
          ...pinnedCat,
          isSelected: pinnedCategory === selectedCategory,
          maxCount,
          overlapCount: pinnedCat.count,
          overlapPercentage: 100
        });
      }
      
      // Add other categories in overlap order
      orderedCategories.forEach(orderedCat => {
        const originalCat = categoryMap[orderedCat.category];
        if (originalCat) {
          const isSelected = orderedCat.category === selectedCategory;
          
          // Get overlap data for non-pinned categories
          let overlapCount = 0;
          let overlapPercentage = 0;
          
          // Always show overlap with pinned category (not with selected category)
          if (pinnedCategory && orderedCat.category !== pinnedCategory) {
            overlapCount = orderedCat.overlap_count;
            overlapPercentage = orderedCat.overlap_percentage;
          }
          
          reorderedCategories.push({
            ...originalCat,
            isSelected,
            maxCount,
            overlapCount,
            overlapPercentage
          });
        }
      });
      
      return reorderedCategories;
    }
    
    // Default behavior: use original distribution
    return distribution.map(category => {
      const isSelected = category.category === selectedCategory;
      
      // Get real overlap data (only for regular category selection, not search results)
      let overlapCount = 0;
      let overlapPercentage = 0;
      
      if (!searchResults && selectedCategory && !isSelected) {
        const overlap = overlapData[category.category];
        if (overlap) {
          overlapCount = overlap.overlap_count;
          overlapPercentage = overlap.overlap_percentage;
        }
      } else if (isSelected) {
        // Selected category should show 100%
        overlapCount = category.count;
        overlapPercentage = 100;
      }
      
      return {
        ...category,
        isSelected,
        maxCount,
        overlapCount,
        overlapPercentage
      };
    }).sort((a, b) => b.count - a.count); // Sort by count descending
  }, [categoryDistribution, selectedCategory, overlapData, searchResults, conceptSearchResults, orderedCategories, pinnedCategory]);

  if (!categoryDistribution || categoryDistribution.length === 0) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Typography>No category data available</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 1 }}>
      {/* Upper part: Concept Query UI */}
      <Box sx={{ mb: 1, flexShrink: 0}}>
        
        {/* Concept Input */}
        <Box sx={{ position: 'relative' }} className="concept-query-container">
          <Input
            placeholder="Search concepts globally"
            value={conceptQuery}
            onChange={(e) => {
              setConceptQuery(e.target.value);
              setShowConceptSuggestions(true);
            }}
            onFocus={() => setShowConceptSuggestions(true)}
            onKeyPress={handleInputKeyPress}
            startDecorator={<SearchIcon sx={{ fontSize: '18px' }} />}
            size="sm"
            sx={{ mb: 1 }}
          />
          
          {/* Concept Suggestions */}
          {showConceptSuggestions && (
            <Box sx={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              zIndex: 1000,
              backgroundColor: 'white',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: '8px',
              maxHeight: '200px',
              overflow: 'auto',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
            }}>
              <List size="sm">
                {filteredConcepts.length > 0 ? (
                  filteredConcepts.map((concept, index) => (
                    <ListItem key={index} sx={{ p: 0 }}>
                      <ListItemButton
                        onClick={() => handleConceptSelect(concept)}
                        sx={{ py: 0.5, px: 1 }}
                      >
                        <Typography level="body-sm">{concept}</Typography>
                      </ListItemButton>
                    </ListItem>
                  ))
                ) : (
                  <ListItem sx={{ p: 1 }}>
                    <Typography level="body-sm" color="neutral.500">
                      No concepts found
                    </Typography>
                  </ListItem>
                )}
              </List>
            </Box>
          )}
        </Box>
        
        {/* Search Results Display */}
        {(searchResults || conceptSearchResults) && (
          <Box sx={{ mb: 1, p: 1, backgroundColor: searchResults?.total_matching_saes === 0 ? 'warning.50' : 'primary.50', borderRadius: '8px', border: '1px solid', borderColor: searchResults?.total_matching_saes === 0 ? 'warning.200' : 'primary.200' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
              <Typography level="body-sm" sx={{ fontWeight: 'bold', color: searchResults?.total_matching_saes === 0 ? 'warning.700' : 'primary.700' }}>
                {searchResults?.total_matching_saes === 0 
                  ? `No features found for "${conceptSearchResults ? conceptSearchResults.concept : searchResults.concept}"`
                  : `Found ${conceptSearchResults ? conceptSearchResults.matchingSaeIndices.length : searchResults.total_matching_saes} features for "${conceptSearchResults ? conceptSearchResults.concept : searchResults.concept}"`
                }
              </Typography>
              <Typography 
                level="body-xs" 
                sx={{ 
                  cursor: 'pointer', 
                  color: searchResults?.total_matching_saes === 0 ? 'warning.600' : 'primary.600',
                  textDecoration: 'underline',
                  '&:hover': { color: searchResults?.total_matching_saes === 0 ? 'warning.800' : 'primary.800' }
                }}
                onClick={clearSearch}
              >
                Clear
              </Typography>
            </Box>
            {searchLoading && (
              <Typography level="body-xs" color="neutral.500">
                Searching...
              </Typography>
            )}
            {searchResults?.total_matching_saes === 0 && !searchLoading && (
              <Typography level="body-xs" color="warning.600">
                Try a different concept or check the spelling
              </Typography>
            )}
          </Box>
        )}
      </Box>

      {/* Lower part: Categories */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Typography level="h6" sx={{ mb: 1, height: '24px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          Categories
        </Typography>
        
        {/* Legend - Show when pinned category is selected */}
        {pinnedCategory && (
          <Box sx={{ 
            mb: 1.5,
            p: 1, 
            bgcolor: 'background.level1', 
            borderRadius: 3,
            flexShrink: 0
          }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ 
                  width: 12, 
                  height: 12, 
                  borderRadius: '50%', 
                  bgcolor: '#1976D2',
                  opacity: 0.7,
                  border: '1px solid white',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                }} />
                <Typography level="body-xs">
                  <strong>{pinnedCategory}</strong> (Pinned)
                </Typography>
              </Box>
              {comparisonCategory && comparisonCategory !== pinnedCategory && (
                <>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ 
                      width: 12, 
                      height: 12, 
                      borderRadius: '50%', 
                      bgcolor: '#D32F2F',
                      opacity: 0.7,
                      border: '1px solid white',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                    }} />
                    <Typography level="body-xs">
                      <strong>{comparisonCategory}</strong> (Comparison)
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                      <Box sx={{ 
                    width: 12, 
                    height: 12, 
                    borderRadius: '50%', 
                    bgcolor: '#9C27B0',
                    opacity: 0.7,
                    border: '1px solid white',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                  }} />
                  <Typography level="body-xs">
                    <strong>Shared</strong> (Both categories)
                  </Typography>
                  </Box>
                </>
              )}
            </Box>
          </Box>
        )}
        
        <Box sx={{ 
          flex: 1, 
          minHeight: 0,
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
          '&::-webkit-scrollbar': {
            display: 'none'
          },
          '&': {
            scrollbarWidth: 'none',
            msOverflowStyle: 'none'
          }
        }}>
          {categoryData.map((category) => (
            <CategoryChip
              key={category.category}
              category={category}
              onSelect={onCategorySelect}
              pinnedCategory={pinnedCategory}
              onPinCategory={onPinCategory}
              comparisonCategory={comparisonCategory}
            />
          ))}
        </Box>
      </Box>
    </Box>
  );
};

// Individual Category Chip Component
const CategoryChip = ({ category, onSelect, pinnedCategory, onPinCategory, comparisonCategory }) => {
  const {
    category: categoryName,
    count,
    isSelected,
    maxCount,
    overlapCount,
    overlapPercentage
  } = category;

  const barWidth = 220; // Fixed width for the bar
  const barHeight = 6;
  const barFillWidth = (count / maxCount) * barWidth;

  // Determine the category state
  const isPinned = pinnedCategory === categoryName;
  const isComparison = comparisonCategory === categoryName;
  const isInComparisonMode = pinnedCategory && comparisonCategory && pinnedCategory !== comparisonCategory;

  const overlapWidth = ((!isSelected && !isComparison) || isComparison) && overlapCount > 0 ? Math.max(Math.min((overlapPercentage / 100) * barFillWidth, barFillWidth), 2) : 0;

  // Create tooltip content
  const tooltipContent = isPinned 
    ? `${categoryName}: ${count} features (PINNED - fixed reference). Click to unpin.`
    : isComparison 
      ? `${categoryName}: ${count} features (COMPARISON target). Click to switch comparison.`
      : isSelected 
        ? `${categoryName}: ${count} features selected (100% of this category). Click to deselect.`
        : overlapCount > 0 
          ? `${categoryName}: ${count} features total, ${overlapCount} features (${overlapPercentage}%) also in selected category`
          : `${categoryName}: ${count} features total, no overlap with selected category`;

  return (
    <Box sx={{ 
      position: 'relative',
      '&:hover .pin-button': {
        opacity: 1
      }
    }}>
      <Tooltip title={tooltipContent} placement="right">
                      <Chip
          variant={(isPinned || isComparison || isSelected) ? "outlined" : "plain"}
          color={isPinned ? "primary" : isSelected ? "primary" : "neutral"}
          onClick={() => onSelect(isSelected ? null : categoryName)}
          sx={{
            width: '100%',
            height: 'auto',
            minHeight: '45px',
            padding: 0.75,
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 0.5,
            borderWidth: (isPinned || isComparison || isSelected) ? '2px' : '0px',
            borderColor: isPinned ? undefined : isComparison ? '#ff6b6b' : undefined,
            backgroundColor: 'white',
            boxSizing: 'border-box',
            '&:hover': {
              backgroundColor: isPinned ? 'primary.50' : isComparison ? '#fff5f5' : 'neutral.100'
            }
          }}
        >
      {/* Top row: Category name and count grouped together */}
      <Box sx={{ 
        display: 'flex', 
        alignItems: 'center',
        width: '100%',
        gap: 0.5
      }}>
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography level="body-sm" sx={{ 
            fontWeight: (isPinned || isComparison) ? 'bold' : 'normal',
            color: isPinned 
              ? 'primary.700' 
              : isComparison 
                ? '#ff6b6b' 
                : isSelected 
                  ? 'primary.700' 
                  : 'inherit'
          }}>
            {categoryName}
          </Typography>
          <Typography 
            level="body-xs" 
            sx={{ 
              color: isPinned 
                ? 'primary.500' 
                : isComparison 
                  ? '#ff6b6b' 
                  : isSelected 
                    ? 'primary.500' 
                    : (!isSelected && overlapCount > 0) 
                      ? 'primary.500' 
                      : 'neutral.500',
              fontWeight: (isPinned || isComparison) ? 'bold' : 'normal'
            }}
          >
            {count} {overlapPercentage > 0 ? `(${overlapPercentage}%)` : ''}
          </Typography>
        </Box>
      </Box>

      {/* Bottom row: Bar */}
      <Box sx={{ 
        width: '100%', 
        display: 'flex', 
        alignItems: 'center'
      }}>
        <Box sx={{ 
          position: 'relative',
          width: barWidth,
          height: barHeight,
          borderRadius: barHeight / 2,
          overflow: 'hidden'
        }}>
          {/* Only show the colored bar, no background */}
          {barFillWidth > 0 && (
            <Box sx={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: barFillWidth,
              height: '100%',
              backgroundColor: isPinned ? 'primary.500' : (isSelected && !isComparison) ? 'primary.500' : 'neutral.300',
              borderRadius: barHeight / 2,
              transition: 'all 0.2s ease'
            }} />
          )}
          
          {/* Overlap highlight for comparison categories (only if not pinned) */}
          {isComparison && !isPinned && overlapCount > 0 && (
            <Box sx={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: overlapWidth,
              height: '100%',
              backgroundColor: '#ff6b6b',
              borderRadius: barHeight / 2,
              opacity: 0.9
            }} />
          )}
          
          {/* Overlap highlight (only for non-selected categories when another is selected) */}
          {!isSelected && !isComparison && overlapCount > 0 && (
            <Box sx={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: overlapWidth,
              height: '100%',
              backgroundColor: 'primary.500',
              borderRadius: barHeight / 2,
              opacity: 0.9
            }} />
          )}
        </Box>
              </Box>
      </Chip>
      </Tooltip>
      
      {/* Pin button positioned absolutely - only show on hover or when pinned */}
      <IconButton
        size="sm"
        variant="plain"
        color={pinnedCategory === categoryName ? "primary" : "neutral"}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log('Pin button clicked for category:', categoryName);
          
          if (pinnedCategory === categoryName) {
            // Unpinning - just unpin, don't change selection
            onPinCategory(null);
          } else {
            // Pinning - pin the category and also select it
            onPinCategory(categoryName);
            onSelect(categoryName);
          }
        }}
        className="pin-button"
        sx={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          p: 0.25,
          minWidth: '20px',
          minHeight: '20px',
          zIndex: 10,
          backgroundColor: 'transparent',
          opacity: pinnedCategory === categoryName ? 1 : 0,
          transition: 'opacity 0.2s ease',
          '&:hover': {
            backgroundColor: 'rgba(0, 0, 0, 0.04)'
          }
        }}
      >
        <PushPinIcon 
          sx={{ 
            fontSize: '16px',
            transform: pinnedCategory === categoryName ? 'rotate(0deg)' : 'rotate(45deg)',
            transition: 'transform 0.2s ease'
          }} 
        />
      </IconButton>
    </Box>
  );
};

export default CategorySidebar;
