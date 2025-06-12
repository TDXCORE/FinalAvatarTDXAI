import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface AudioTestPanelProps {
  onAudioTest: (audioBlob: Blob) => void;
}

export default function AudioTestPanel({ onAudioTest }: AudioTestPanelProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [micPermission, setMicPermission] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [testResults, setTestResults] = useState<string[]>([]);
  
  const audioChunksRef = useRef<Blob[]>([]);
  const animationFrameRef = useRef<number>();

  useEffect(() => {
    checkMicrophonePermission();
    return () => {
      cleanup();
    };
  }, []);

  const checkMicrophonePermission = async () => {
    try {
      const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      setMicPermission(result.state as any);
      
      result.addEventListener('change', () => {
        setMicPermission(result.state as any);
      });
    } catch (error) {
      console.log('Permission API not supported, will test during mic access');
    }
  };

  const initializeAudio = async () => {
    try {
      addTestResult('🎤 Requesting microphone access...');
      
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 44100,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      setStream(newStream);
      setMicPermission('granted');
      addTestResult('✅ Microphone access granted');

      // Set up audio context and analyser
      const context = new AudioContext({ sampleRate: 44100 });
      const source = context.createMediaStreamSource(newStream);
      const analyserNode = context.createAnalyser();
      
      analyserNode.fftSize = 2048;
      analyserNode.smoothingTimeConstant = 0.8;
      source.connect(analyserNode);

      setAudioContext(context);
      setAnalyser(analyserNode);
      addTestResult('✅ Audio analysis setup complete');

      // Set up media recorder
      const recorder = new MediaRecorder(newStream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        addTestResult(`🎵 Audio recorded: ${audioBlob.size} bytes`);
        onAudioTest(audioBlob);
        audioChunksRef.current = [];
      };

      setMediaRecorder(recorder);
      addTestResult('✅ Media recorder setup complete');

      // Start audio level monitoring
      startAudioLevelMonitoring(analyserNode);

      return true;
    } catch (error) {
      console.error('Audio initialization failed:', error);
      setMicPermission('denied');
      addTestResult(`❌ Audio initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  };

  const startAudioLevelMonitoring = (analyserNode: AnalyserNode) => {
    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const updateLevel = () => {
      analyserNode.getByteFrequencyData(dataArray);
      
      // Calculate average level
      const average = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;
      setAudioLevel(Math.round(average));

      if (analyser) {
        animationFrameRef.current = requestAnimationFrame(updateLevel);
      }
    };

    updateLevel();
  };

  const startRecording = async () => {
    if (!stream || !mediaRecorder) {
      const success = await initializeAudio();
      if (!success) return;
    }

    if (mediaRecorder && mediaRecorder.state === 'inactive') {
      setIsRecording(true);
      audioChunksRef.current = [];
      mediaRecorder.start();
      addTestResult('🔴 Recording started...');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      setIsRecording(false);
      mediaRecorder.stop();
      addTestResult('⏹️ Recording stopped');
    }
  };

  const testAudioCapture = async () => {
    addTestResult('🧪 Starting 3-second audio test...');
    await startRecording();
    
    setTimeout(() => {
      stopRecording();
    }, 3000);
  };

  const cleanup = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    
    if (audioContext) {
      audioContext.close();
    }
  };

  const addTestResult = (message: string) => {
    setTestResults(prev => [...prev.slice(-9), `${new Date().toLocaleTimeString()}: ${message}`]);
  };

  const clearResults = () => {
    setTestResults([]);
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Audio System Test
          <Badge variant={micPermission === 'granted' ? 'default' : 'destructive'}>
            {micPermission}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Audio Level Meter */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Audio Level:</span>
            <span>{audioLevel}</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className="bg-green-600 h-2 rounded-full transition-all duration-100" 
              style={{ width: `${Math.min(100, (audioLevel / 128) * 100)}%` }}
            />
          </div>
        </div>

        {/* Control Buttons */}
        <div className="flex gap-2">
          <Button 
            onClick={testAudioCapture}
            disabled={isRecording}
            className="flex-1"
          >
            {isRecording ? 'Recording...' : 'Test 3s'}
          </Button>
          <Button 
            onClick={initializeAudio}
            variant="outline"
            disabled={isRecording}
          >
            Init Audio
          </Button>
        </div>

        {/* Manual Controls */}
        <div className="flex gap-2">
          <Button 
            onClick={startRecording}
            disabled={isRecording || !stream}
            variant="outline"
            size="sm"
          >
            Start Rec
          </Button>
          <Button 
            onClick={stopRecording}
            disabled={!isRecording}
            variant="outline"
            size="sm"
          >
            Stop Rec
          </Button>
          <Button 
            onClick={clearResults}
            variant="outline"
            size="sm"
          >
            Clear
          </Button>
        </div>

        {/* Test Results */}
        <div className="space-y-1">
          <h4 className="text-sm font-medium">Test Results:</h4>
          <div className="bg-gray-50 p-2 rounded text-xs max-h-32 overflow-y-auto space-y-1">
            {testResults.length === 0 ? (
              <div className="text-gray-500">No tests run yet</div>
            ) : (
              testResults.map((result, index) => (
                <div key={index} className="font-mono">{result}</div>
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}