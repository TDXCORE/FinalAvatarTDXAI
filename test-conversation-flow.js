/**
 * Script de prueba para simular flujos de conversación con interrupciones
 * Simula: hablar -> avatar responde -> interrumpir -> hablar -> avatar responde
 */

// Función para simular un evento personalizado
function triggerEvent(eventName, detail = {}) {
  const event = new CustomEvent(eventName, { detail });
  window.dispatchEvent(event);
  console.log(`🎬 Test Event: ${eventName}`, detail);
}

// Función para simular transcripción de voz
function simulateVoiceTranscription(text, isFinal = true) {
  console.log(`🎤 Simulando transcripción: "${text}"`);
  triggerEvent('test-voice-transcription', { text, isFinal });
}

// Función para simular envío de texto al avatar
function simulateAvatarResponse(text) {
  console.log(`🤖 Simulando respuesta del avatar: "${text}"`);
  triggerEvent('test-send-stream-text', { text });
}

// Función para simular interrupción manual
function simulateManualInterrupt() {
  console.log(`🛑 Simulando interrupción manual`);
  triggerEvent('test-manual-interrupt');
}

// Función para simular interrupción por voz (barge-in)
function simulateVoiceInterrupt() {
  console.log(`🔥 Simulando interrupción por voz (barge-in)`);
  triggerEvent('test-voice-interrupt');
}

// Test Case 1: Conversación normal sin interrupciones
async function testNormalConversation() {
  console.log('\n=== TEST 1: Conversación Normal ===');
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  simulateVoiceTranscription("Hola, ¿cómo estás?");
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  console.log('✅ Test 1: Conversación normal completada');
}

// Test Case 2: Conversación con interrupción manual
async function testManualInterruptConversation() {
  console.log('\n=== TEST 2: Interrupción Manual ===');
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  simulateVoiceTranscription("Cuéntame una historia larga");
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  simulateManualInterrupt();
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  simulateVoiceTranscription("Mejor hablemos de otra cosa");
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  console.log('✅ Test 2: Interrupción manual completada');
}

// Test Case 3: Conversación con barge-in por voz
async function testVoiceInterruptConversation() {
  console.log('\n=== TEST 3: Barge-in por Voz ===');
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  simulateVoiceTranscription("Explícame algo complejo");
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  simulateVoiceInterrupt();
  
  await new Promise(resolve => setTimeout(resolve, 500));
  simulateVoiceTranscription("Espera, tengo una pregunta");
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  console.log('✅ Test 3: Barge-in por voz completada');
}

// Test Case 4: Múltiples interrupciones consecutivas
async function testMultipleInterrupts() {
  console.log('\n=== TEST 4: Múltiples Interrupciones ===');
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  simulateVoiceTranscription("Empecemos una conversación");
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  simulateVoiceInterrupt();
  
  await new Promise(resolve => setTimeout(resolve, 500));
  simulateVoiceTranscription("Primera interrupción");
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  simulateManualInterrupt();
  
  await new Promise(resolve => setTimeout(resolve, 500));
  simulateVoiceTranscription("Segunda interrupción");
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  simulateVoiceTranscription("Conversación final");
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  console.log('✅ Test 4: Múltiples interrupciones completadas');
}

// Función principal para ejecutar todos los tests
async function runAllTests() {
  console.log('🚀 Iniciando Tests de Flujo de Conversación');
  console.log('Monitorea los logs de la consola para ver el comportamiento del sistema');
  
  await testNormalConversation();
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  await testManualInterruptConversation();
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  await testVoiceInterruptConversation();
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  await testMultipleInterrupts();
  
  console.log('\n🎉 Todos los tests completados');
  console.log('Revisa los logs para identificar problemas en el flujo');
}

// Función para ejecutar un test específico
function runSingleTest(testNumber) {
  switch(testNumber) {
    case 1:
      testNormalConversation();
      break;
    case 2:
      testManualInterruptConversation();
      break;
    case 3:
      testVoiceInterruptConversation();
      break;
    case 4:
      testMultipleInterrupts();
      break;
    default:
      console.log('Test número inválido. Usa 1-4');
  }
}

// Exponer funciones globalmente para uso manual
window.conversationTest = {
  runAllTests,
  runSingleTest,
  simulateVoiceTranscription,
  simulateAvatarResponse,
  simulateManualInterrupt,
  simulateVoiceInterrupt
};

console.log('🔧 Script de prueba cargado.');
console.log('Uso:');
console.log('- conversationTest.runAllTests() - Ejecuta todos los tests');
console.log('- conversationTest.runSingleTest(1-4) - Ejecuta un test específico');
console.log('- conversationTest.simulateVoiceTranscription("texto") - Simula voz');
console.log('- conversationTest.simulateManualInterrupt() - Simula interrupción manual');