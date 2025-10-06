const CONFIG = {
  PROGRAM_ID: '67c8c14f5f17a83b745e3f82',
  SHEERID_BASE_URL: 'https://services.sheerid.com',
  MY_SHEERID_URL: 'https://my.sheerid.com',
  
  // hCaptcha配置（留空关闭）
  HCAPTCHA_SECRET: '', // 留空关闭hCaptcha验证
  
  // Turnstile配置（留空关闭）
  TURNSTILE_SECRET: '', // 留空关闭Turnstile验证
  
  // 文件大小限制
  MAX_FILE_SIZE: 1 * 1024 * 1024, // 1MB
};

// CORS头
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

// 生成设备指纹
function generateDeviceFingerprint() {
  const chars = '0123456789abcdef';
  let fingerprint = '';
  for (let i = 0; i < 32; i++) {
    fingerprint += chars[Math.floor(Math.random() * chars.length)];
  }
  return fingerprint;
}

// 验证hCaptcha token
async function verifyHcaptcha(token) {
  if (!CONFIG.HCAPTCHA_SECRET || !token) {
    return { success: !CONFIG.HCAPTCHA_SECRET }; // 如果没配置，返回成功
  }
  
  const response = await fetch('https://hcaptcha.com/siteverify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `response=${token}&secret=${CONFIG.HCAPTCHA_SECRET}`
  });
  
  return await response.json();
}

// 验证Turnstile token
async function verifyTurnstile(token) {
  if (!CONFIG.TURNSTILE_SECRET || !token) {
    return { success: !CONFIG.TURNSTILE_SECRET }; // 如果没配置，返回成功
  }
  
  const formData = new FormData();
  formData.append('secret', CONFIG.TURNSTILE_SECRET);
  formData.append('response', token);
  
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: formData,
  });
  
  return await response.json();
}

// SheerID API请求
async function sheerIdRequest(method, url, body = null, headers = {}) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  };
  
  if (body) {
    options.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  
  const response = await fetch(url, options);
  const text = await response.text();
  
  try {
    return { data: JSON.parse(text), status: response.status };
  } catch {
    return { data: text, status: response.status };
  }
}

// 上传图片到S3
async function uploadToS3(uploadUrl, imageBlob) {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'image/png'
    },
    body: imageBlob
  });
  
  return { success: response.ok, status: response.status };
}

// 处理验证请求
async function handleVerification(request) {
  const logs = []; // 收集日志用于返回给前端
  
  const addLog = (message, type = 'debug') => {
    logs.push({ 
      message, 
      type, 
      timestamp: new Date().toISOString() 
    });
    console.log(`[${type.toUpperCase()}] ${message}`);
  };
  
  try {
    const formData = await request.formData();
    
    // 获取表单数据
    const firstName = formData.get('firstName');
    const lastName = formData.get('lastName');
    const email = formData.get('email');
    const birthDate = formData.get('birthDate');
    const verificationId = formData.get('verificationId') || '';
    const schoolId = formData.get('schoolId') || '11320406';
    const studentCardFile = formData.get('studentCard');
    const hcaptchaToken = formData.get('hcaptchaToken');
    const turnstileToken = formData.get('turnstileToken');
    
    // 验证Turnstile
    if (CONFIG.TURNSTILE_SECRET) {
      addLog('Verifying Turnstile...', 'info');
      const turnstileResult = await verifyTurnstile(turnstileToken);
      if (!turnstileResult.success) {
        addLog('Turnstile verification failed', 'error');
        throw new Error('Turnstile verification failed. Please complete the captcha.');
      }
      addLog('Turnstile verified successfully', 'success');
    }

    // 验证hCaptcha
    if (CONFIG.HCAPTCHA_SECRET) {
      addLog('Verifying hCaptcha...', 'info');
      const hcaptchaResult = await verifyHcaptcha(hcaptchaToken);
      if (!hcaptchaResult.success) {
        addLog('hCaptcha verification failed', 'error');
        throw new Error('hCaptcha verification failed. Please complete the captcha.');
      }
      addLog('hCaptcha verified successfully', 'success');
    }

    // 检查文件大小
    const fileSize = await studentCardFile.arrayBuffer();
    if (fileSize.byteLength > CONFIG.MAX_FILE_SIZE) {
      const sizeMB = (fileSize.byteLength / (1024 * 1024)).toFixed(2);
      addLog(`File size (${sizeMB}MB) exceeds 1MB limit`, 'error');
      throw new Error(`File size (${sizeMB}MB) exceeds maximum allowed size of 1MB`);
    }
    
    addLog(`File size: ${(fileSize.byteLength / 1024).toFixed(2)}KB`, 'debug');
    
    // 生成设备指纹
    const deviceFingerprintHash = generateDeviceFingerprint();
    
    addLog(`Starting verification for ${firstName} ${lastName}`, 'info');
    addLog(`Email: ${email}`, 'debug');
    addLog(`Birth Date: ${birthDate}`, 'debug');
    addLog(`Verification ID: ${verificationId}`, 'debug');
    addLog(`School ID: ${schoolId}`, 'debug');
    addLog(`Device fingerprint: ${deviceFingerprintHash}`, 'debug');
    
    const schools = {
      '11320406': { 
        name: 'Massachusetts Institute of Technology (Cambridge, MA)', 
        idExtended: '11320406',
        domain: 'MIT.EDU'
      },
    };
    
    const school = schools[schoolId] || schools['11320406'];
    addLog(`School: ${school.name}`, 'info');
    
    // Step 2: 提交学生信息
    addLog('Step 2/7: Submitting student information...', 'info');
    
    const step2Body = {
      firstName,
      lastName,
      birthDate,
      email,
      phoneNumber: "",
      organization: {
        id: parseInt(schoolId),
        idExtended: school.idExtended,
        name: school.name
      },
      deviceFingerprintHash,
      locale: "en-US",
      metadata: {
        marketConsentValue: false,
        refererUrl: `${CONFIG.SHEERID_BASE_URL}/verify/${CONFIG.PROGRAM_ID}/?verificationId=${verificationId}`,
        verificationId,
        flags: JSON.stringify({
          "collect-info-step-email-first": "default",
          "doc-upload-considerations": "default",
          "doc-upload-may24": "default",
          "doc-upload-redesign-use-legacy-message-keys": false,
          "docUpload-assertion-checklist": "default",
          "font-size": "default",
          "include-cvec-field-france-student": "not-labeled-optional"
        }),
        submissionOptIn: "By submitting the personal information above, I acknowledge that my personal information is being collected under the privacy policy of the business from which I am seeking a discount"
      }
    };
    
    const step2Response = await sheerIdRequest(
      'POST',
      `${CONFIG.SHEERID_BASE_URL}/rest/v2/verification/${verificationId}/step/collectStudentPersonalInfo`,
      step2Body
    );
    
    if (step2Response.status !== 200) {
      addLog(`Step 2 failed with status ${step2Response.status}`, 'error');
      throw new Error(`Step 2 failed: ${JSON.stringify(step2Response.data)}`);
    }
    
    addLog(`Step 2 completed: ${step2Response.data.currentStep}`, 'success');
    
    // Step 3: 跳过SSO
    addLog('Step 3/7: Skipping SSO verification...', 'info');
    
    const step3Response = await sheerIdRequest(
      'DELETE',
      `${CONFIG.SHEERID_BASE_URL}/rest/v2/verification/${verificationId}/step/sso`
    );
    
    addLog(`Step 3 completed: ${step3Response.data.currentStep}`, 'success');
    
    // Step 4: 获取上传URL
    addLog('Step 4/7: Requesting document upload URL...', 'info');
    
    const step4Body = {
      files: [{
        fileName: "student_card.png",
        mimeType: "image/png",
        fileSize: fileSize.byteLength
      }]
    };
    
    const step4Response = await sheerIdRequest(
      'POST',
      `${CONFIG.SHEERID_BASE_URL}/rest/v2/verification/${verificationId}/step/docUpload`,
      step4Body
    );
    
    if (!step4Response.data.documents || !step4Response.data.documents[0]) {
      addLog('Failed to get upload URL', 'error');
      throw new Error('No upload URL received');
    }
    
    const uploadUrl = step4Response.data.documents[0].uploadUrl;
    addLog('Upload URL obtained', 'success');
    addLog(`Upload URL: ${uploadUrl.substring(0, 50)}...`, 'debug');
    
    // Step 5: 上传图片到S3
    addLog('Step 5/7: Uploading student card to S3...', 'info');
    
    const uploadResult = await uploadToS3(uploadUrl, fileSize);
    
    if (!uploadResult.success) {
      addLog(`Upload failed with status ${uploadResult.status}`, 'error');
      throw new Error('Failed to upload student card to S3');
    }
    
    addLog('Student card uploaded successfully', 'success');
    
    // Step 6: 完成文档上传
    addLog('Step 6/7: Completing document upload...', 'info');
    
    const step6Response = await sheerIdRequest(
      'POST',
      `${CONFIG.SHEERID_BASE_URL}/rest/v2/verification/${verificationId}/step/completeDocUpload`
    );
    
    addLog(`Step 6 completed: ${step6Response.data.currentStep}`, 'success');
    
    // Step 7: 检查验证状态
    addLog('Step 7/7: Checking verification status...', 'info');
    
    let attempts = 0;
    let success = false;
    let finalStatus = null;
    
    while (attempts < 3 && !success) {
      await new Promise(resolve => setTimeout(resolve, 3000)); // 等待3秒
      
      const statusResponse = await sheerIdRequest(
        'GET',
        `${CONFIG.MY_SHEERID_URL}/rest/v2/verification/${verificationId}`
      );
      
      finalStatus = statusResponse.data;
      attempts++;
      
      addLog(`Status check ${attempts}/10: ${finalStatus.currentStep}`, 'debug');
      
      if (finalStatus.currentStep === 'success') {
        success = true;
        addLog('✅ Verification successful!', 'success');
        if (finalStatus.redirectUrl) {
          addLog(`Redirect URL: ${finalStatus.redirectUrl}`, 'info');
        }
        break;
      } else if (finalStatus.currentStep === 'rejected') {
        addLog('❌ Verification rejected', 'error');
        break;
      } else if (finalStatus.currentStep === 'error') {
        addLog('❌ Verification error', 'error');
        break;
      }
    }
    
    if (!success && attempts >= 10) {
      addLog('⏱️ Verification timeout - max attempts reached', 'warning');
    }
    
    // 返回结果
    return new Response(JSON.stringify({
      success,
      message: success ? 'Verification successful!' : 
               (finalStatus?.currentStep === 'rejected' ? 'Verification rejected' : 
                'Verification timeout or failed'),
      verificationId,
      redirectUrl: finalStatus?.redirectUrl,
      status: finalStatus,
      logs // 返回所有日志给前端
    }), {
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
    
  } catch (error) {
    addLog(`Fatal error: ${error.message}`, 'error');
    addLog(`Stack trace: ${error.stack}`, 'debug');
    
    return new Response(JSON.stringify({
      success: false,
      message: error.message || 'Verification process failed',
      error: error.toString(),
      logs // 即使出错也返回日志
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders
      }
    });
  }
}

// Worker主入口
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 处理OPTIONS请求（CORS预检）
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    // 路由处理
    switch (url.pathname) {
      case '/':
        // 返回提示信息
        return new Response('SheerID Verification Worker is running. Deploy the HTML interface to use.', {
          headers: { 'Content-Type': 'text/plain', ...corsHeaders }
        });
        
      case '/api/verify':
        if (request.method === 'POST') {
          return handleVerification(request);
        }
        return new Response('Method Not Allowed', { 
          status: 405,
          headers: corsHeaders 
        });
        
      case '/health':
        return new Response(JSON.stringify({ 
          status: 'healthy',
          captcha: {
            hcaptcha: !!CONFIG.HCAPTCHA_SECRET,
            turnstile: !!CONFIG.TURNSTILE_SECRET
          },
          maxFileSize: CONFIG.MAX_FILE_SIZE,
          timestamp: new Date().toISOString() 
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
        
      default:
        return new Response('Not Found', { 
          status: 404,
          headers: corsHeaders 
        });
    }
  },

};
