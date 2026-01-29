#!/bin/bash

# Quick Setup Script for Stock Price Auto-Update
# This script helps you set up the automated stock price updates

echo "======================================"
echo "TIPS Music Stock Price Auto-Update"
echo "Quick Setup Script"
echo "======================================"
echo ""

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

echo "✅ Node.js found: $(node --version)"
echo ""

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✅ npm found: $(npm --version)"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Creating from template..."
    cp .env.example .env
    echo "✅ .env file created. Please edit it with your credentials:"
    echo "   - SUPABASE_URL"
    echo "   - SUPABASE_SERVICE_KEY"
    echo "   - CRON_SECRET"
    echo ""
    echo "To edit: nano .env"
    echo ""
else
    echo "✅ .env file found"
    echo ""
fi

# Generate a random CRON_SECRET if needed
echo "🔐 Generate random CRON_SECRET? (y/n)"
read -r response
if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
    SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    echo ""
    echo "Your CRON_SECRET:"
    echo "$SECRET"
    echo ""
    echo "Add this to your .env file and Vercel environment variables"
    echo ""
fi

# Test database connection
echo "🧪 Test database connection? (y/n)"
read -r response
if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
    echo "Running database connection test..."
    node -e "
        require('dotenv').config();
        const { createClient } = require('@supabase/supabase-js');
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );
        
        (async () => {
            try {
                const { data, error } = await supabase
                    .from('stock_prices')
                    .select('*')
                    .limit(1);
                
                if (error) throw error;
                console.log('✅ Database connection successful!');
                console.log('Sample data:', data);
            } catch (err) {
                console.error('❌ Database connection failed:', err.message);
            }
        })();
    "
    echo ""
fi

# Summary
echo "======================================"
echo "Setup Summary"
echo "======================================"
echo ""
echo "Next steps:"
echo "1. Edit .env with your Supabase credentials"
echo "2. Run: npm run test-cron (to test locally)"
echo "3. Push to GitHub: git push origin main"
echo "4. Add environment variables to Vercel"
echo "5. Deploy: vercel --prod"
echo ""
echo "📖 See DEPLOYMENT_GUIDE.md for detailed instructions"
echo ""
echo "✨ Setup complete!"
