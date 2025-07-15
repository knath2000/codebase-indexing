// Test script to debug LangDB API call matching our implementation
async function testLangDB() {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer langdb_ZnJYWUJmZVFOQnVsV3E=`,
    'x-api-key': 'langdb_ZnJYWUJmZVFOQnVsV3E=',
    'x-project-id': 'ad29a93e-567e-4cad-a816-fff3d4215d2b'
  };

  const body = {
    model: 'openai/gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a helpful assistant that ranks search results.'
      },
      {
        role: 'user', 
        content: 'Rank these results: [1, 2, 3]. Return JSON with rankedIndices array.'
      }
    ],
    stream: false
  };

  console.log('Testing LangDB with headers:', Object.keys(headers));
  console.log('Project ID:', headers['x-project-id']);

  try {
    const response = await fetch('https://api.us-east-1.langdb.ai/ad29a93e-567e-4cad-a816-fff3d4215d2b/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    console.log('Status:', response.status);
    console.log('Status Text:', response.statusText);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log('Error Response:', errorText);
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    console.log('Success! Response:', JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testLangDB(); 