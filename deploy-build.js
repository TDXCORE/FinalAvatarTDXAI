#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Starting deployment build...');

try {
  // Run the original build command
  console.log('Running vite build...');
  execSync('vite build', { stdio: 'inherit', cwd: process.cwd() });
  
  console.log('Running esbuild for server...');
  execSync('esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist', { stdio: 'inherit', cwd: process.cwd() });
  
  // Check if dist/public exists
  const publicDir = path.join(process.cwd(), 'dist', 'public');
  const distDir = path.join(process.cwd(), 'dist');
  
  if (fs.existsSync(publicDir)) {
    console.log('Moving files from dist/public to dist...');
    
    // Get all files and directories in dist/public
    const items = fs.readdirSync(publicDir);
    
    // Move each item to dist root
    items.forEach(item => {
      const srcPath = path.join(publicDir, item);
      const destPath = path.join(distDir, item);
      
      // Remove destination if it exists
      if (fs.existsSync(destPath)) {
        fs.rmSync(destPath, { recursive: true, force: true });
      }
      
      // Move the item
      fs.renameSync(srcPath, destPath);
    });
    
    // Remove the empty public directory
    fs.rmSync(publicDir, { recursive: true, force: true });
    
    console.log('Build files successfully moved for deployment');
  } else {
    console.log('No dist/public directory found, build completed normally');
  }
  
  console.log('Deployment build completed successfully!');
  
} catch (error) {
  console.error('Build failed:', error.message);
  process.exit(1);
}