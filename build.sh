#!/bin/bash

# Run the original build command
npm run build

# Move files from dist/public to dist root
if [ -d "dist/public" ]; then
    # Copy all files from dist/public to dist
    cp -r dist/public/* dist/
    
    # Remove the public subdirectory
    rm -rf dist/public
    
    echo "Build files moved from dist/public to dist for deployment"
else
    echo "No dist/public directory found"
fi