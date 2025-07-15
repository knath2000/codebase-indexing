// Test script matching exactly the LangDB dashboard example
const fetch = require('node-fetch');

async function testLangDBDashboardExample() {
  const url = "https://api.us-east-1.langdb.ai/ad29a93e-567e-4cad-a816-fff3d4215d2b/v1/chat/completions";

  const payload = {
    "model": "openai/gpt-4o-mini",
    "messages": [
      {
        "role": "system",
        "content": "You are a helpful assistant."
      },
      {
        "role": "user",
        "content": "What are the earnings of Apple in 2022?"
      }
    ],
    "stream": false // Changed to false for easier testing
  };

  const headers = {
    "authorization": "Bearer langdb_ZnJYWUJmZVFOQnVsV3E=",
    "Content-Type": "application/json"
  };

  console.log('Testing LangDB with EXACT dashboard headers:', headers);
  console.log('URL:', url);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    });

    console.log('Status:', response.status);
    console.log('Status Text:', response.statusText);
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ SUCCESS! Response:', JSON.stringify(data, null, 2));
    } else {
      const errorText = await response.text();
      console.log('❌ ERROR Response:', errorText);
    }
  } catch (error) {
    console.log('❌ Network Error:', error.message);
  }
}

testLangDBDashboardExample(); 